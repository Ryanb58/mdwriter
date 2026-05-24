import { useEffect, useRef } from "react"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { basename, parent, joinPath } from "../../lib/paths"
import { refreshTree } from "../tree/useTreeActions"
import { noteSelfWrite } from "../watcher/useExternalChanges"
import { getBody } from "../../lib/doc"

const UNTITLED_PATTERN = /^untitled(\s+\d+)?\.(md|markdown)$/i

function extractFirstH1(markdown: string): string | null {
  // Strip leading frontmatter block first so a YAML key starting with "#" can't trip us up.
  const stripped = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "")
  const m = stripped.match(/^#\s+(.+?)\s*$/m)
  return m ? m[1].trim() : null
}

function slugify(text: string): string {
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
 * After an auto-save settles on an "untitled*.md" file, if the body has a first
 * H1, rename the file to a slugified version of that heading.
 *
 * Only runs when settings.autoRenameFromH1 is on.
 */
export function useAutoRename() {
  const doc = useStore((s) => s.openDoc)
  const settings = useStore((s) => s.settings)
  // Tracks rename attempts in flight, keyed by the source path. Prevents the
  // effect from kicking off a second async rename for the same path while one
  // is already running (effect deps change as dirty/savedAt/rawMarkdown
  // settle). Entries are cleared in the async's `finally` so a brand-new file
  // re-created at the same path later — `untitled.md` is the obvious case —
  // can still be renamed.
  const inFlight = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!settings.autoRenameFromH1) return
    if (!doc) return
    if (doc.dirty) return                  // wait for the save to settle
    if (!doc.savedAt) return               // never saved → not eligible
    const name = basename(doc.path)
    if (!UNTITLED_PATTERN.test(name)) return
    if (inFlight.current.has(doc.path)) return

    const h1 = extractFirstH1(getBody(doc.text))
    if (!h1) return

    const slug = slugify(h1)
    if (!slug) return

    const parentDir = parent(doc.path)
    const fromPath = doc.path
    inFlight.current.add(fromPath)

    ;(async () => {
      try {
        // Find a non-colliding path; rename_path errors on collision, so loop.
        for (let n = 1; n <= 200; n++) {
          const target = joinPath(parentDir, n === 1 ? `${slug}.md` : `${slug}-${n}.md`)
          if (target === fromPath) return
          try {
            noteSelfWrite(target)
            noteSelfWrite(fromPath)
            await ipc.renamePath(fromPath, target)
            await refreshTree()
            // Update editor state to point at the renamed path.
            useStore.setState((s) => {
              const nextPaths = new Set(s.selectedPaths)
              if (nextPaths.has(fromPath)) {
                nextPaths.delete(fromPath)
                nextPaths.add(target)
              } else {
                nextPaths.add(target)
              }
              return {
                selectedPath: target,
                selectedPaths: nextPaths,
                openDoc: s.openDoc && s.openDoc.path === fromPath
                  ? { ...s.openDoc, path: target }
                  : s.openDoc,
              }
            })
            return
          } catch {
            // Collision — try the next suffix.
          }
        }
      } finally {
        inFlight.current.delete(fromPath)
      }
    })().catch((e) => console.error("auto-rename failed", e))
  }, [doc?.path, doc?.dirty, doc?.savedAt, doc?.text, settings.autoRenameFromH1])
}
