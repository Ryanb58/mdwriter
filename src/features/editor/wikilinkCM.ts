/**
 * CodeMirror 6 extensions that make wikilinks and internal markdown links
 * clickable + completable in the raw editor.
 *
 *   • `decorateLinks` — adds a `.wikilink` class to runs that match the
 *     wikilink or markdown-internal-link pattern, so the shared click
 *     handler in `useLinkActivation` picks them up.
 *   • `wikilinkCompletion` — a manual popup that opens when the caret
 *     follows an unclosed `[[`, listing vault notes; arrow keys + enter
 *     to select, esc to dismiss. Inserts `[[Name]]` and moves the cursor
 *     past the closing brackets.
 */
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view"
import type { Extension } from "@codemirror/state"
import type { VaultNote } from "../../lib/vaultNotes"
import { isInternalHref } from "../../lib/wikilinkResolve"

// A wikilink `[[Foo]]` or `[[Foo.md|alias]]`.
const WIKILINK_RE = /\[\[([^\[\]\r\n]+?)\]\]/g
// A standard markdown link `[label](href)` — we only decorate when href
// looks internal (no scheme, no fragment). Captures: label, href.
const MD_LINK_RE = /\[([^\]\r\n]+)\]\(([^)\r\n]+)\)/g

function wikilinkMatchDecoration(text: string) {
  // text is the entire match including the brackets. The decoration spans
  // the whole `[[...]]` run so clicking anywhere in it follows the link.
  const inner = text.slice(2, -2)
  const target = inner.split("|", 1)[0]?.trim() ?? ""
  return Decoration.mark({
    class: "wikilink wikilink--resolved cm-wikilink",
    attributes: { "data-target": target },
  })
}

function mdInternalMatchDecoration(match: RegExpExecArray) {
  // We carry the href through `data-target` so the same click handler used
  // by BlockNote (`.wikilink[data-target]`) resolves it. The handler runs
  // decodeURIComponent before passing to the resolver, so storing the raw
  // href (`Three%20laws%20of%20motion.md`) is correct.
  return Decoration.mark({
    class: "wikilink wikilink--resolved cm-md-link",
    attributes: { "data-target": match[2] || "" },
  })
}

const wikilinkDecorator = new MatchDecorator({
  regexp: WIKILINK_RE,
  decoration: (m) => wikilinkMatchDecoration(m[0]),
})

const mdLinkDecorator = new MatchDecorator({
  regexp: MD_LINK_RE,
  decoration: (m) => {
    const href = m[2] || ""
    if (!isInternalHref(href)) return null
    return mdInternalMatchDecoration(m)
  },
})

export const decorateLinks: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = wikilinkDecorator.createDeco(view)
      }
      update(u: ViewUpdate) {
        this.decorations = wikilinkDecorator.updateDeco(u, this.decorations)
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
        this.decorations = mdLinkDecorator.updateDeco(u, this.decorations)
      }
    },
    { decorations: (v) => v.decorations },
  ),
  // We want the `.wikilink--resolved` styling to drop the link's
  // text-decoration since the markdown text itself shows the brackets.
  EditorView.theme({
    ".cm-content .wikilink, .cm-content .cm-wikilink, .cm-content .cm-md-link": {
      color: "var(--accent, oklch(0.65 0.18 250))",
      textDecoration: "none",
      cursor: "pointer",
    },
  }),
]

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
 * Hook the editor's selection/changes to compute the current trigger,
 * exposing it via a callback so React can render the popup.
 */
export function wikilinkCompletion(
  onState: (state: WikilinkCompletionState | null) => void,
): Extension {
  return ViewPlugin.fromClass(
    class {
      lastQuery: string | null = null
      constructor(view: EditorView) {
        this.compute(view)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.focusChanged) this.compute(u.view)
      }
      compute(view: EditorView) {
        const sel = view.state.selection.main
        if (!sel.empty) {
          if (this.lastQuery !== null) onState(null)
          this.lastQuery = null
          return
        }
        const pos = sel.head
        const lineStart = view.state.doc.lineAt(pos).from
        // Restrict the lookback to the current line so we don't scan
        // megabytes on a paste.
        const text = view.state.doc.sliceString(lineStart, pos)
        const trig = detectWikilinkTrigger(text, text.length)
        if (!trig) {
          if (this.lastQuery !== null) onState(null)
          this.lastQuery = null
          return
        }
        const from = lineStart + trig.start
        const coords = view.coordsAtPos(pos)
        const popupCoords = coords
          ? { left: coords.left, top: coords.top, bottom: coords.bottom }
          : null
        const next: WikilinkCompletionState = {
          from,
          to: pos,
          query: trig.query,
          coords: popupCoords,
        }
        this.lastQuery = trig.query
        onState(next)
      }
      destroy() {
        onState(null)
      }
    },
  ).extension
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
