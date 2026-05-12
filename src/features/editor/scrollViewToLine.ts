import { EditorView } from "@codemirror/view"

/**
 * Place the caret at the start of `line` (1-indexed) and scroll the editor
 * so that line is visible, centered when possible. Returns true if the scroll
 * dispatched, false if the view is empty or the line is out of range
 * (defensive — we clamp, so this is rare).
 */
export function scrollViewToLine(view: EditorView, line: number): boolean {
  const totalLines = view.state.doc.lines
  if (totalLines === 0) return false
  const target = Math.max(1, Math.min(totalLines, Math.floor(line)))
  const lineInfo = view.state.doc.line(target)
  view.dispatch({
    selection: { anchor: lineInfo.from, head: lineInfo.from },
    effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
  })
  view.focus()
  return true
}
