import { useCallback, useEffect, useState } from "react"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { findNode } from "../tree/findNode"

export function useOpenFile() {
  const selectedPath = useStore((s) => s.selectedPath)
  const setOpenDoc = useStore((s) => s.setOpenDoc)
  const openAnalyzedDocument = useStore((s) => s.openAnalyzedDocument)
  const setLoadError = useStore((s) => s.setLoadError)
  const [retryToken, setRetryToken] = useState(0)

  const retry = useCallback(() => setRetryToken((value) => value + 1), [])

  useEffect(() => {
    if (!selectedPath) {
      setOpenDoc(null)
      setLoadError(null)
      return
    }
    const currentError = useStore.getState().loadError
    if (currentError && currentError.path !== selectedPath) setLoadError(null)
    // If the selected row is a directory, leave the current openDoc alone —
    // tree selection (highlight) is independent of which file is open.
    const node = findNode(useStore.getState().tree, selectedPath)
    if (node?.kind === "dir") return
    // Skip non-markdown paths: covers phantom tree entries (folder not yet
    // reflected) and visible non-markdown file nodes (PDFs, images, etc.).
    if (!/\.(md|markdown)$/i.test(selectedPath)) return
    let cancelled = false
    ;(async () => {
      try {
        const text = await ipc.readFile(selectedPath)
        if (cancelled) return
        openAnalyzedDocument(selectedPath, text, "disk")
      } catch (e) {
        if (cancelled) return
        setLoadError({
          path: selectedPath,
          message: e instanceof Error ? e.message : String(e),
        })
      }
    })()
    return () => { cancelled = true }
  }, [openAnalyzedDocument, retryToken, selectedPath, setLoadError, setOpenDoc])

  return { retry }
}
