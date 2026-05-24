import { useEffect } from "react"
import { useStore } from "../../lib/store"

export function useEditorMode() {
  const mode = useStore((s) => s.editorMode)
  const setMode = useStore((s) => s.setEditorMode)

  // Pure view switch. The block editor binds to `doc.rawMarkdown` (body
  // only); the raw editor binds to `doc.text` (full file). Both are kept
  // mutually consistent by the editor mirrors in EditorPane / BlockEditor
  // — toggling modes is no longer a parse/serialize round-trip.
  async function toggle() {
    const doc = useStore.getState().openDoc
    if (!doc) return
    setMode(mode === "block" ? "raw" : "block")
  }

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
  })

  return { mode, toggle }
}
