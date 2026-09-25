import { useEffect } from "react"
import { flattenOutlineBlocks, outlineBlockIds, sectionAt } from "./documentOutline"
import { useDocumentOutline } from "./DocumentOutline"

type OutlineEditor = {
  document: Parameters<typeof outlineBlockIds>[1]
  isFocused: () => boolean
  getTextCursorPosition: () => { block: { id: string } }
  setTextCursorPosition: (id: string, placement: "start") => void
  focus: () => void
  onSelectionChange: (callback: () => void) => () => void
}

export function useBlockOutline(editor: OutlineEditor, hostRef: React.RefObject<HTMLDivElement | null>) {
  const outline = useDocumentOutline()
  const headings = outline?.headings
  const navigate = outline?.navigate
  const setActive = outline?.setActive
  const enabled = outline?.open && outline.ready
  useEffect(() => {
    const host = hostRef.current
    if (!enabled || !host || !headings || !navigate || !setActive) return
    let frame: number | null = null
    const nodeFor = (id: string) => host.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
    const report = (selection = false) => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        const ids = outlineBlockIds(headings, editor.document)
        if (ids.length !== headings.length) {
          setActive(-1)
          return
        }
        if (selection) {
          const blocks = flattenOutlineBlocks(editor.document)
          let cursor: string
          try {
            cursor = editor.getTextCursorPosition().block.id
          } catch { return }
          const positions = new Map(blocks.map((block, index) => [block.id, index]))
          setActive(sectionAt(ids.map((id) => positions.get(id)!), positions.get(cursor) ?? -1))
        } else {
          const tops = ids.map((id) => nodeFor(id)?.getBoundingClientRect().top ?? Infinity)
          setActive(sectionAt(tops, host.getBoundingClientRect().top + 24))
        }
      })
    }
    navigate.current = (index) => {
      const id = outlineBlockIds(headings, editor.document)[index]
      const node = id ? nodeFor(id) : null
      if (!id || !node) return false
      try {
        // Use BlockNote's transaction API, preserving its model, undo history,
        // inline content, and selection plugins; do not reparse the document.
        editor.setTextCursorPosition(id, "start")
        editor.focus()
        host.scrollTop += node.getBoundingClientRect().top - host.getBoundingClientRect().top - 16
        return true
      } catch { return false } // A block disappeared during an edit.
    }
    const scroll = () => report(false)
    const selection = () => report(true)
    const unsubscribe = editor.onSelectionChange(selection)
    const observer = new MutationObserver(() => report(editor.isFocused()))
    observer.observe(host, { childList: true, subtree: true, characterData: true })
    host.addEventListener("scroll", scroll, { passive: true })
    window.addEventListener("resize", scroll)
    report(editor.isFocused())
    return () => {
      navigate.current = null
      unsubscribe()
      observer.disconnect()
      host.removeEventListener("scroll", scroll)
      window.removeEventListener("resize", scroll)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [editor, hostRef, enabled, headings, navigate, setActive])
}
