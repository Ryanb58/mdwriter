import { useCallback, useEffect } from "react"
import { useStore, type EditorMode } from "../../lib/store"

export function useEditorMode() {
  const mode = useStore((s) => s.editorMode)
  const requestEditorMode = useStore((s) => s.requestEditorMode)

  // Pure view switch. The block editor binds to `getBody(doc.text)`
  // (body only); the raw editor binds to `doc.text` (full file). Both
  // are views over the same canonical buffer — toggling is just a
  // renderer swap, no parse/serialize round-trip.
  const requestMode = useCallback((nextMode: EditorMode) => {
    const doc = useStore.getState().openDoc
    if (!doc) return "changed" as const
    return requestEditorMode(nextMode)
  }, [requestEditorMode])

  const toggle = useCallback(() => {
    const state = useStore.getState()
    if (!state.openDoc) return "changed" as const
    return requestEditorMode(state.editorMode === "block" ? "raw" : "block")
  }, [requestEditorMode])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === "e") {
        e.preventDefault()
        toggle()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [toggle])

  return { mode, requestMode, toggle }
}
