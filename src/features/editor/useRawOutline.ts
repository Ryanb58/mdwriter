import { useCallback, useEffect, useRef } from "react"
import { EditorView } from "@codemirror/view"
import { rawHeadingPosition, sectionAt } from "./documentOutline"
import { useDocumentOutline } from "./DocumentOutline"

export function useRawOutline(viewRef: React.RefObject<EditorView | null>) {
  const outline = useDocumentOutline()
  const current = useRef(outline)
  current.current = outline
  const frame = useRef<number | null>(null)
  const report = useCallback((selection = false) => {
    if (!current.current?.open || !current.current.ready) return
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const view = viewRef.current
      const state = current.current
      if (!view || !state?.open || !state.ready) return
      const rect = view.scrollDOM.getBoundingClientRect()
      const pos = selection ? view.state.selection.main.head : view.posAtCoords({
        x: view.contentDOM.getBoundingClientRect().left + 4,
        y: rect.top + 16,
      }, false)
      if (pos !== null) {
        const positions = state.headings.map((h) => rawHeadingPosition(h, view.state.doc) ?? Infinity)
        state.setActive(sectionAt(positions, pos))
      }
    })
  }, [viewRef])
  const headings = outline?.headings
  const navigate = outline?.navigate
  const enabled = outline?.open && outline.ready
  useEffect(() => {
    const view = viewRef.current
    if (!enabled || !view || !headings || !navigate) return
    navigate.current = (index) => {
      const heading = headings[index]
      if (!heading) return false
      const position = rawHeadingPosition(heading, view.state.doc)
      if (position === null) return false
      // A selection-only transaction preserves Markdown, undo history, mode,
      // and CodeMirror's own cursor/IME semantics. Never mutate the DOM caret.
      view.dispatch({
        selection: { anchor: position },
        effects: EditorView.scrollIntoView(position, { y: "start", yMargin: 16 }),
      })
      view.focus()
      return true
    }
    const scroll = () => report(false)
    view.scrollDOM.addEventListener("scroll", scroll, { passive: true })
    report(view.hasFocus)
    return () => {
      navigate.current = null
      view.scrollDOM.removeEventListener("scroll", scroll)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [enabled, headings, navigate, report, viewRef])
  return report
}
