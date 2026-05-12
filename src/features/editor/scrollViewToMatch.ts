import { EditorView } from "@codemirror/view"
import { scrollViewToLine } from "./scrollViewToLine"

/**
 * Walk the CM doc for the `occurrence`-th case-insensitive match of `needle`,
 * scroll it into view (centered), place the caret at its start, and return
 * the match's document range. The range is suitable for `view.coordsAtPos`
 * if the caller wants to draw a transient highlight.
 *
 * When no match exists (doc edited since the search ran), falls back to
 * scrolling `fallbackLine` and returns null.
 */
export function scrollViewToMatch(
  view: EditorView,
  needle: string,
  occurrence: number,
  fallbackLine: number,
): { from: number; to: number } | null {
  if (!needle) {
    scrollViewToLine(view, fallbackLine)
    return null
  }
  const target = Math.max(0, Math.floor(occurrence))
  const text = view.state.doc.toString()
  const lower = text.toLowerCase()
  const n = needle.toLowerCase()

  let count = 0
  let lastPos: { from: number; to: number } | null = null
  let i = 0
  while ((i = lower.indexOf(n, i)) >= 0) {
    const pos = { from: i, to: i + needle.length }
    if (count === target) {
      jumpTo(view, pos.from)
      return pos
    }
    lastPos = pos
    count++
    i += needle.length
  }

  if (lastPos) {
    // Fewer matches than expected — settle on the last one rather than
    // dropping the user back at the top.
    jumpTo(view, lastPos.from)
    return lastPos
  }

  scrollViewToLine(view, fallbackLine)
  return null
}

function jumpTo(view: EditorView, pos: number) {
  view.dispatch({
    selection: { anchor: pos, head: pos },
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
  })
  view.focus()
}
