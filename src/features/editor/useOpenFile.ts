import { useCallback, useEffect, useState } from "react"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { flushOpenDocSave } from "../../lib/writeDoc"
import { errorText } from "../../lib/toast"
import { findNode } from "../tree/findNode"

export function useOpenFile() {
  const selectedPath = useStore((s) => s.selectedPath)
  const setOpenDoc = useStore((s) => s.setOpenDoc)
  const openAnalyzedDocument = useStore((s) => s.openAnalyzedDocument)
  const setLoadError = useStore((s) => s.setLoadError)
  const [retryToken, setRetryToken] = useState(0)

  const retry = useCallback(() => setRetryToken((value) => value + 1), [])

  useEffect(() => {
    const sourceDoc = useStore.getState().openDoc
    let sourcePath = sourceDoc?.path ?? null

    const currentError = useStore.getState().loadError
    if (currentError && currentError.path !== selectedPath) setLoadError(null)

    // Selection restoration after a rejected save lands here. The original
    // buffer is already open, so there is nothing to read or replace.
    if (selectedPath && selectedPath === sourcePath) return

    // If the selected row is a directory, leave the current openDoc alone —
    // tree selection (highlight) is independent of which file is open.
    const node = selectedPath
      ? findNode(useStore.getState().tree, selectedPath)
      : null
    if (node?.kind === "dir") return
    // Skip non-markdown paths: covers phantom tree entries (folder not yet
    // reflected) and visible non-markdown file nodes (PDFs, images, etc.).
    if (selectedPath && !/\.(md|markdown)$/i.test(selectedPath)) return

    if (!selectedPath && !sourcePath) {
      setOpenDoc(null)
      setLoadError(null)
      return
    }

    let cancelled = false

    const restoreSourceSelection = () => {
      const current = useStore.getState()
      if (cancelled || current.selectedPath !== selectedPath) return
      useStore.setState({
        selectedPath: sourcePath,
        selectedPaths: sourcePath ? new Set([sourcePath]) : new Set(),
        pendingCursorAtEnd: current.pendingCursorAtEnd === selectedPath
          ? null
          : current.pendingCursorAtEnd,
        pendingScroll: current.pendingScroll?.path === selectedPath
          ? null
          : current.pendingScroll,
      })
    }

    ;(async () => {
      if (sourcePath) {
        try {
          // Await the coordinator before crossing the read boundary. This
          // serializes the old document's bytes ahead of any replacement and
          // prevents a later path from replacing its single queued snapshot.
          await flushOpenDocSave(sourcePath)
          // A concurrent rename can move the buffer while this navigation is
          // waiting at the coordinator barrier. Follow the live source path
          // for any later edit or failure restoration.
          sourcePath = useStore.getState().openDoc?.path ?? null
        } catch {
          restoreSourceSelection()
          return
        }
      }

      if (cancelled || useStore.getState().selectedPath !== selectedPath) return

      if (!selectedPath) {
        setOpenDoc(null)
        setLoadError(null)
        return
      }

      try {
        const snapshot = await ipc.readFile(selectedPath)
        if (cancelled || useStore.getState().selectedPath !== selectedPath) return

        // The read can be slow enough for the user to type into the old note.
        // Flush those latest bytes while the old path is still current before
        // replacing the buffer with the newly read document.
        const current = useStore.getState().openDoc
        if (current?.path === selectedPath) return
        if (current?.dirty) {
          sourcePath = current.path
          try {
            await flushOpenDocSave(sourcePath)
          } catch {
            restoreSourceSelection()
            return
          }
        }
        if (cancelled || useStore.getState().selectedPath !== selectedPath) return
        if (useStore.getState().openDoc?.path === selectedPath) return
        // The digest travels with the text: it is the precondition every save
        // of this buffer asserts against (S2.3).
        openAnalyzedDocument(selectedPath, snapshot.text, "disk", snapshot.digest)
      } catch (e) {
        if (cancelled) return
        setLoadError({
          path: selectedPath,
          message: errorText(e),
        })
      }
    })()
    return () => { cancelled = true }
  }, [openAnalyzedDocument, retryToken, selectedPath, setLoadError, setOpenDoc])

  return { retry }
}
