import { useEffect } from "react"
import type { EditorView } from "@codemirror/view"
import { useStore } from "../../lib/store"
import {
  saveImage,
  mimeToExt,
  guessMimeFromName,
  readClipboardImageAsPng,
} from "../../lib/imagePaste"

function isImageFile(f: File): boolean {
  return Boolean(mimeToExt(f.type) || guessMimeFromName(f.name))
}

function firstImageFromFiles(files: FileList | null): File | null {
  if (!files) return null
  for (const f of Array.from(files)) {
    if (isImageFile(f)) return f
  }
  return null
}

function firstImageFromItems(items: DataTransferItemList | null): File | null {
  if (!items) return null
  for (const item of Array.from(items)) {
    if (item.kind === "file") {
      const f = item.getAsFile()
      if (f && isImageFile(f)) return f
    }
  }
  return null
}

async function insertImageBytes(
  view: EditorView,
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  const { rootPath, openDoc, settings } = useStore.getState()
  if (!rootPath || !openDoc) return
  const result = await saveImage({
    bytes,
    mime,
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

async function insertImage(view: EditorView, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = file.type || guessMimeFromName(file.name) || "application/octet-stream"
  await insertImageBytes(view, bytes, mime)
}

export function useRawImagePaste(
  viewRef: React.MutableRefObject<EditorView | null>,
): void {
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const host = view.dom

    function onPaste(e: ClipboardEvent) {
      const cd = e.clipboardData
      const file = firstImageFromItems(cd?.items ?? null)
      if (file) {
        e.preventDefault()
        void insertImage(view!, file).catch((err) => {
          console.error("[image paste] raw paste failed:", err)
        })
        return
      }
      // WKWebView clipboard fallback: types includes "Files" but items
      // are empty. Read the image natively.
      if (cd && cd.items.length === 0 && Array.from(cd.types).includes("Files")) {
        e.preventDefault()
        void (async () => {
          try {
            const bytes = await readClipboardImageAsPng()
            if (bytes) await insertImageBytes(view!, bytes, "image/png")
          } catch (err) {
            console.error("[image paste] raw clipboard fallback failed:", err)
          }
        })()
      }
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
