/**
 * CodeMirror 6 extensions that make wikilinks and internal markdown links
 * clickable + completable in the raw editor.
 *
 *   • `decorateLinks` — adds a `.wikilink` class to runs that match the
 *     wikilink or markdown-internal-link pattern. The class carries a
 *     `--resolved` or `--broken` modifier so the shared CSS shows broken
 *     links in danger tint (matches the BlockNote inline-content behavior).
 *     The shared click handler in `useLinkActivation` picks up clicks via
 *     the `data-target` attribute regardless of resolution state.
 *   • `wikilinkCompletion` — a manual popup that opens when the caret
 *     follows an unclosed `[[`, listing vault notes; arrow keys + enter
 *     to select, esc to dismiss. Inserts `[[Name]]` and moves the cursor
 *     past the closing brackets.
 */
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view"
import { StateEffect, type Extension } from "@codemirror/state"
import type { VaultNote } from "../../lib/vaultNotes"
import { isInternalHref, resolveLinkTarget } from "../../lib/wikilinkResolve"

// A wikilink `[[Foo]]` or `[[Foo.md|alias]]`.
const WIKILINK_RE = /\[\[([^\[\]\r\n]+?)\]\]/g
// A standard markdown link `[label](href)`. The negative-lookbehind for `!`
// is what keeps image syntax `![alt](src.png)` from being matched as an
// internal link. We only decorate when the href looks internal.
const MD_LINK_RE = /(?<!!)\[([^\]\r\n]+)\]\(([^)\r\n]+)\)/g

function resolvedClass(target: string, notes: VaultNote[]): string {
  return resolveLinkTarget(target, notes) ? "wikilink--resolved" : "wikilink--broken"
}

function wikilinkDecoration(text: string, notes: VaultNote[]) {
  // text is the entire match including the brackets. The decoration spans
  // the whole `[[...]]` run so clicking anywhere in it follows the link.
  const inner = text.slice(2, -2)
  const target = inner.split("|", 1)[0]?.trim() ?? ""
  return Decoration.mark({
    class: `wikilink ${resolvedClass(target, notes)} cm-wikilink`,
    attributes: { "data-target": target },
  })
}

function mdInternalDecoration(href: string, notes: VaultNote[]) {
  // We carry the raw href through `data-target` so the same click handler
  // used by BlockNote (`.wikilink[data-target]`) resolves it. The handler
  // runs decodeURIComponent before passing to the resolver, so storing the
  // raw href (`Three%20laws%20of%20motion.md`) is correct.
  return Decoration.mark({
    class: `wikilink ${resolvedClass(href, notes)} cm-md-link`,
    attributes: { "data-target": href },
  })
}

/**
 * Dispatch this effect via `view.dispatch({effects: rebuildLinkDecorations.of()})`
 * to force the decoration ViewPlugin to recompute when the vault note list
 * changes (so resolved↔broken styling updates without a doc edit).
 */
export const rebuildLinkDecorations = StateEffect.define<void>()

/**
 * Build the raw-mode decoration extensions. `getNotes` is called lazily
 * at each decoration rebuild so the resolver always sees the current
 * vault. Call `view.dispatch({effects: rebuildLinkDecorations.of()})`
 * from React when the note list changes.
 */
export function decorateLinks(getNotes: () => VaultNote[]): Extension {
  const wikilinkDecorator = new MatchDecorator({
    regexp: WIKILINK_RE,
    decoration: (m) => wikilinkDecoration(m[0], getNotes()),
  })
  const mdLinkDecorator = new MatchDecorator({
    regexp: MD_LINK_RE,
    decoration: (m) => {
      const href = m[2] || ""
      if (!isInternalHref(href)) return null
      return mdInternalDecoration(href, getNotes())
    },
  })
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = wikilinkDecorator.createDeco(view)
        }
        update(u: ViewUpdate) {
          // Rebuild from scratch on a rebuild effect (notes list changed),
          // otherwise let MatchDecorator handle incremental updates.
          if (u.transactions.some((tr) => tr.effects.some((e) => e.is(rebuildLinkDecorations)))) {
            this.decorations = wikilinkDecorator.createDeco(u.view)
          } else {
            this.decorations = wikilinkDecorator.updateDeco(u, this.decorations)
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = mdLinkDecorator.createDeco(view)
        }
        update(u: ViewUpdate) {
          if (u.transactions.some((tr) => tr.effects.some((e) => e.is(rebuildLinkDecorations)))) {
            this.decorations = mdLinkDecorator.createDeco(u.view)
          } else {
            this.decorations = mdLinkDecorator.updateDeco(u, this.decorations)
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.theme({
      ".cm-content .wikilink, .cm-content .cm-wikilink, .cm-content .cm-md-link": {
        textDecoration: "none",
        cursor: "pointer",
      },
    }),
  ]
}

// ---------- autocomplete -----------------------------------------------

export type WikilinkCompletionState = {
  /** Document offset of the `[` that opened the link. */
  from: number
  /** Caret position. */
  to: number
  /** Text between `[[` and the caret. */
  query: string
  /** Pixel coords for the popup (relative to viewport). */
  coords: { left: number; top: number; bottom: number } | null
}

/** Look back from `pos` in `text` for an unclosed `[[`. */
export function detectWikilinkTrigger(
  text: string,
  pos: number,
  maxLen = 80,
): { start: number; query: string } | null {
  if (pos < 2) return null
  const limit = Math.max(0, pos - maxLen)
  for (let i = pos - 1; i >= limit; i--) {
    const ch = text[i]
    if (ch === "]" || ch === "\n") return null
    if (ch === "[") {
      if (i > 0 && text[i - 1] === "[") {
        const start = i - 1
        const query = text.slice(start + 2, pos)
        if (query.includes("[")) return null
        return { start, query }
      }
      return null
    }
  }
  return null
}

/**
 * Apply a wikilink selection to the editor: replace `[[query` (and any
 * `]]` immediately after the caret) with `[[noteName]]` and move the
 * caret past the closing brackets.
 */
export function applyWikilinkInsertion(
  view: EditorView,
  from: number,
  to: number,
  noteName: string,
) {
  const doc = view.state.doc
  // Eat a trailing `]]` if it's already there (e.g. the user typed `[[]]`).
  let endTo = to
  if (doc.sliceString(to, to + 2) === "]]") endTo = to + 2
  const insert = `[[${noteName}]]`
  view.dispatch({
    changes: { from, to: endTo, insert },
    selection: { anchor: from + insert.length },
  })
  view.focus()
}

/**
 * Public surface returned by `wikilinkCompletion()`. The `extension` plugs
 * into the editor; `dismiss()` snapshots the current trigger so the popup
 * stays hidden until the user types or moves to a different trigger. No
 * document mutation involved — the suppression is plugin-local state.
 */
export type WikilinkCompletion = {
  extension: Extension
  dismiss: () => void
}

/**
 * Hook the editor's selection/changes to compute the current trigger,
 * exposing it via a callback so React can render the popup.
 *
 * Dismissal: when the popup calls `dismiss()`, we snapshot the current
 * `(from, to, query)` and suppress `onState` while the live trigger still
 * matches that snapshot. The first character the user types changes the
 * snapshot (different `to`/`query`), so the popup reopens naturally. No
 * document mutation needed.
 */
export function wikilinkCompletion(
  onState: (state: WikilinkCompletionState | null) => void,
): WikilinkCompletion {
  let dismissedSnapshot: { from: number; to: number; query: string } | null = null
  let lastState: WikilinkCompletionState | null = null
  let emittedNull = false

  function emit(next: WikilinkCompletionState | null) {
    if (next === null) {
      if (!emittedNull) {
        emittedNull = true
        lastState = null
        onState(null)
      }
      return
    }
    emittedNull = false
    lastState = next
    onState(next)
  }

  const extension = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.compute(view)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.focusChanged) this.compute(u.view)
      }
      compute(view: EditorView) {
        const sel = view.state.selection.main
        if (!sel.empty) {
          emit(null)
          return
        }
        const pos = sel.head
        const lineStart = view.state.doc.lineAt(pos).from
        // Restrict the lookback to the current line so we don't scan
        // megabytes on a paste.
        const text = view.state.doc.sliceString(lineStart, pos)
        const trig = detectWikilinkTrigger(text, text.length)
        if (!trig) {
          // The trigger context is gone; clear dismissal too so the popup
          // can reopen on the next valid `[[`.
          dismissedSnapshot = null
          emit(null)
          return
        }
        const from = lineStart + trig.start
        const snap = { from, to: pos, query: trig.query }
        if (
          dismissedSnapshot &&
          dismissedSnapshot.from === snap.from &&
          dismissedSnapshot.to === snap.to &&
          dismissedSnapshot.query === snap.query
        ) {
          // Still dismissed; stay hidden but keep watching.
          emit(null)
          return
        }
        // Any movement past the dismissal point invalidates dismissal.
        dismissedSnapshot = null
        const coords = view.coordsAtPos(pos)
        const popupCoords = coords
          ? { left: coords.left, top: coords.top, bottom: coords.bottom }
          : null
        emit({ ...snap, coords: popupCoords })
      }
      destroy() {
        emit(null)
      }
    },
  ).extension

  function dismiss() {
    if (!lastState) return
    dismissedSnapshot = {
      from: lastState.from,
      to: lastState.to,
      query: lastState.query,
    }
    emit(null)
  }

  return { extension, dismiss }
}

// Helper for the React popup — pick top matches.
export function filterNotes(notes: VaultNote[], query: string, max = 8): VaultNote[] {
  const q = query.trim().toLowerCase()
  if (!q) return notes.slice(0, max)
  const scored: { n: VaultNote; score: number }[] = []
  for (const n of notes) {
    const name = n.name.toLowerCase()
    const rel = n.rel.toLowerCase()
    const ni = name.indexOf(q)
    const ri = rel.indexOf(q)
    if (ni < 0 && ri < 0) continue
    scored.push({ n, score: ni >= 0 ? ni : 1000 + ri })
  }
  scored.sort((a, b) => a.score - b.score || a.n.name.localeCompare(b.n.name))
  return scored.slice(0, max).map((s) => s.n)
}
