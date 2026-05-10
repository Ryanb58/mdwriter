import { useEffect } from "react"
import type { EditorView } from "@codemirror/view"
import { useStore } from "../../lib/store"
import { saveImage, mimeToExt } from "../../lib/imagePaste"

function firstImageFromFiles(files: FileList | null): File | null {
  if (!files) return null
  for (const f of Array.from(files)) {
    if (mimeToExt(f.type)) return f
  }
  return null
}

function firstImageFromItems(items: DataTransferItemList | null): File | null {
  if (!items) return null
  for (const item of Array.from(items)) {
    if (item.kind === "file") {
      const f = item.getAsFile()
      if (f && mimeToExt(f.type)) return f
    }
  }
  return null
}

async function insertImage(view: EditorView, file: File): Promise<void> {
  const { rootPath, openDoc, settings } = useStore.getState()
  if (!rootPath || !openDoc) return
  const bytes = new Uint8Array(await file.arrayBuffer())
  const result = await saveImage({
    bytes,
    mime: file.type || "application/octet-stream",
    vaultRoot: rootPath,
    docPath: openDoc.path,
    location: settings.imagesLocation,
    template: settings.imageFilenameTemplate,
  })
  const insert = `![](${result.relativePath})`
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  })
  view.focus()
}

export function useRawImagePaste(
  viewRef: React.MutableRefObject<EditorView | null>,
): void {
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const host = view.dom

    function onPaste(e: ClipboardEvent) {
      const file = firstImageFromItems(e.clipboardData?.items ?? null)
      if (!file) return
      e.preventDefault()
      void insertImage(view!, file).catch((err) => {
        console.error("paste image failed", err)
      })
    }

    function onDrop(e: DragEvent) {
      const file = firstImageFromFiles(e.dataTransfer?.files ?? null)
      if (!file) return
      e.preventDefault()
      void insertImage(view!, file).catch((err) => {
        console.error("drop image failed", err)
      })
    }

    host.addEventListener("paste", onPaste)
    host.addEventListener("drop", onDrop)
    return () => {
      host.removeEventListener("paste", onPaste)
      host.removeEventListener("drop", onDrop)
    }
  }, [viewRef])
}
