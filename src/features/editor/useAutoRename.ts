import { useEffect, useRef } from "react"
import { ipc } from "../../lib/ipc"
import { useStore, type OpenDoc } from "../../lib/store"
import { basename, parent, joinPath } from "../../lib/paths"
import { refreshTree } from "../tree/useTreeActions"
import { noteSelfWrite } from "../watcher/useExternalChanges"
import { getBody } from "../../lib/doc"
import { beginOpenDocPathMutation } from "../../lib/writeDoc"
import { remapOpenDocumentPath } from "../../lib/openDocumentPaths"

const UNTITLED_PATTERN = /^untitled(\s+\d+)?\.(md|markdown)$/i

// Matches a single line that is an H1 with non-empty text. Not `m`/`g` —
// callers apply it per line so the greedy trailing `\s*` can't reach across
// lines and swallow following newlines.
const H1_LINE_RE = /^#\s+(.+?)\s*$/

function stripFrontmatter(markdown: string): string {
  // Strip a leading frontmatter block so a YAML key starting with "#" can't trip us up.
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "")
}

export function extractFirstH1(markdown: string): string | null {
  for (const line of stripFrontmatter(markdown).split("\n")) {
    const m = line.match(H1_LINE_RE)
    if (m) return m[1].trim()
  }
  return null
}

/**
 * Like {@link extractFirstH1}, but only returns the heading once the user has
 * *committed* to it — i.e. moved past the heading line rather than still
 * typing it. Committed means there's a line after the heading that has real
 * content, or there's more than one line after it (a blank line, i.e. Enter
 * was pressed — BlockNote emits an empty paragraph as `\n\n`). A bare
 * `# title`, or one with a single trailing newline (ambiguous: both the
 * markdown export and a single raw-mode Enter produce it), does not count.
 *
 * This is what keeps "2026-06" from being grabbed mid-keystroke: while the
 * heading is the last thing in the document, it isn't committed yet, so we
 * wait for the next Enter / first body character before naming the file.
 */
export function extractCommittedH1(markdown: string): string | null {
  const lines = stripFrontmatter(markdown).split("\n")
  const idx = lines.findIndex((l) => H1_LINE_RE.test(l))
  if (idx === -1) return null
  const rest = lines.slice(idx + 1)
  const committed = rest.some((l) => l.trim() !== "") || rest.length > 1
  if (!committed) return null
  return lines[idx].match(H1_LINE_RE)![1].trim()
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/[^a-z0-9\s-]+/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

/**
 * True for the one retriable `rename_path` failure: the target name is already
 * taken. The Rust command returns `AppError::Io("destination exists: …")`,
 * which crosses the IPC boundary as `{ kind: "Io", message: "destination
 * exists: …" }` (see `src-tauri/src/errors.rs`).
 */
function isDestinationExists(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false
  const { kind, message } = e as { kind?: unknown; message?: unknown }
  return kind === "Io" && typeof message === "string" && message.startsWith("destination exists:")
}

/**
 * Renames `fromPath` to `<slug>.md` (or `<slug>-N.md` on collision) and points
 * editor/selection/pinned state that referenced the old path at the new one.
 * State for paths the rename doesn't touch is left alone, so this is safe to
 * call for a *previously* open doc after the user has already switched files.
 */
async function performRename(
  fromPath: string,
  slug: string,
  inFlight: Set<string>,
  renamedAway: Set<string>,
): Promise<void> {
  if (inFlight.has(fromPath)) return
  inFlight.add(fromPath)
  const parentDir = parent(fromPath)
  try {
    const guard = await beginOpenDocPathMutation([fromPath])
    try {
      // Find a non-colliding path; rename_path errors on collision, so loop.
      for (let n = 1; n <= 200; n++) {
        const target = joinPath(parentDir, n === 1 ? `${slug}.md` : `${slug}-${n}.md`)
        if (target === fromPath) return
        try {
          noteSelfWrite(target)
          noteSelfWrite(fromPath)
          await ipc.renamePath(fromPath, target)
          // Record the move *before* the state change that re-renders, so the
          // leave-fallback effect doesn't try to rename the now-gone source.
          renamedAway.add(fromPath)
          guard.remap(fromPath, target)
          remapOpenDocumentPath(fromPath, target)
          await refreshTree()
          return
        } catch (e) {
          // Only a name collision is retriable — try the next suffix. Any other
          // error (permissions, missing source, …) must surface, not spin 200×.
          if (isDestinationExists(e)) continue
          throw e
        }
      }
    } finally {
      guard.release()
    }
  } finally {
    inFlight.delete(fromPath)
  }
}

/**
 * Auto-names an "untitled*.md" file from its first H1.
 *
 * Two triggers, both gated on `settings.autoRenameFromH1`:
 *
 * 1. **Committed heading** — once an auto-save settles and the H1 has been
 *    committed (the user pressed Enter / started the body), rename to a
 *    slugified version of that heading. Waiting for the commit is what stops
 *    a half-typed heading (e.g. "2026-06" on the way to "2026-06-06") from
 *    being grabbed during a mid-typing pause.
 *
 * 2. **Leaving the note** — when the user switches files (or closes the
 *    editor) with a still-untitled note whose only content is an uncommitted
 *    H1, name it from that heading anyway so a title-only note doesn't stay
 *    "untitled". Only fires for a clean, saved doc, so there's no pending
 *    write to race.
 */
export function useAutoRename() {
  const doc = useStore((s) => s.openDoc)
  const settings = useStore((s) => s.settings)
  // Block-mode commitment signal: set by the block editor when a block exists
  // after the first H1 (Enter pressed). In block mode that trailing paragraph
  // is trimmed from the markdown, so the text never gains a newline and the
  // text-based commit check below can't see it.
  const headingCommittedPath = useStore((s) => s.headingCommittedPath)
  // Tracks rename attempts in flight, keyed by the source path. Prevents the
  // effect from kicking off a second async rename for the same path while one
  // is already running (effect deps change as dirty/savedAt/text settle).
  // Entries are cleared in the async's `finally` so a brand-new file
  // re-created at the same path later — `untitled.md` is the obvious case —
  // can still be renamed.
  const inFlight = useRef<Set<string>>(new Set())
  // Paths we just renamed away from. The leave-fallback effect sees the same
  // path change our own rename causes; this lets it tell "user switched files"
  // from "we renamed this doc" and skip the latter.
  const renamedAway = useRef<Set<string>>(new Set())
  // The doc seen on the previous render, so the leave-fallback can act on the
  // note we just navigated *away* from (with its latest text).
  const prevDoc = useRef<OpenDoc | null>(null)

  // Trigger 1: rename the active doc once its committed H1 has settled.
  useEffect(() => {
    if (!settings.autoRenameFromH1) return
    if (!doc) return
    if (doc.dirty) return                  // wait for the save to settle
    if (!doc.savedAt) return               // never saved → not eligible
    if (!UNTITLED_PATTERN.test(basename(doc.path))) return

    const body = getBody(doc.text)
    // Committed by either signal: text moved past the heading (raw mode, or a
    // body character typed), or the block editor reported a block after the H1.
    const committed =
      extractCommittedH1(body) !== null || headingCommittedPath === doc.path
    if (!committed) return
    const h1 = extractFirstH1(body)
    if (!h1) return
    const slug = slugify(h1)
    if (!slug) return

    performRename(doc.path, slug, inFlight.current, renamedAway.current).catch((e) =>
      console.error("auto-rename failed", e),
    )
  }, [doc?.path, doc?.dirty, doc?.savedAt, doc?.text, headingCommittedPath, settings.autoRenameFromH1])

  // Trigger 2: when the open doc changes, the note we just left may have an
  // uncommitted H1 that never got named. Catch it on the way out.
  //
  // `dirty` and `savedAt` are in the deps (not just path/text) so this re-runs
  // when an autosave settles and refreshes `prevDoc` to the clean, saved
  // version. Autosave flips those two fields without touching path or text, so
  // without them `prevDoc` would stay frozen at the dirty in-progress state and
  // `maybeRenameOnLeave`'s clean+saved guard would always skip on switch.
  useEffect(() => {
    const prev = prevDoc.current
    prevDoc.current = doc ?? null
    if (!prev) return
    if (prev.path === doc?.path) return    // same doc, just an edit — not a switch
    maybeRenameOnLeave(prev, inFlight.current, renamedAway.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.path, doc?.text, doc?.dirty, doc?.savedAt])

  // And on unmount, flush the last-open note the same way.
  useEffect(() => {
    return () => {
      const prev = prevDoc.current
      if (prev) maybeRenameOnLeave(prev, inFlight.current, renamedAway.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function maybeRenameOnLeave(
  prev: OpenDoc,
  inFlight: Set<string>,
  renamedAway: Set<string>,
): void {
  // Our own rename produced this path change — nothing to do.
  if (renamedAway.has(prev.path)) {
    renamedAway.delete(prev.path)
    return
  }
  if (!useStore.getState().settings.autoRenameFromH1) return
  // Only act on a clean, saved doc: the bytes are on disk and no debounced
  // write is pending, so renaming the file can't race a trailing save.
  if (prev.dirty || !prev.savedAt) return
  if (!UNTITLED_PATTERN.test(basename(prev.path))) return

  const h1 = extractFirstH1(getBody(prev.text))
  if (!h1) return
  const slug = slugify(h1)
  if (!slug) return

  performRename(prev.path, slug, inFlight, renamedAway).catch((e) =>
    console.error("auto-rename (on leave) failed", e),
  )
}
