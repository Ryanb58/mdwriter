import { useEffect, useMemo, useRef } from "react"
import type { BlockNoteEditor, PartialBlock } from "@blocknote/core"
import { useCreateBlockNote } from "@blocknote/react"
import { BlockNoteView } from "@blocknote/mantine"
import "@blocknote/mantine/style.css"
import { convertFileSrc } from "@tauri-apps/api/core"
import { useResolvedTheme } from "../settings/useTheme"
import { useStore } from "../../lib/store"
import {
  saveImage,
  guessMimeFromName,
  readClipboardImageAsPng,
  resolveAgainstDocDir,
} from "../../lib/imagePaste"

export function BlockEditor({
  initialMarkdown,
  onChangeMarkdown,
  docKey,
}: {
  initialMarkdown: string
  onChangeMarkdown: (md: string) => void
  docKey: string
}) {
  const initializedKey = useRef<string | null>(null)
  const lastEmitted = useRef<string>("")
  const theme = useResolvedTheme()

  const editor = useCreateBlockNote(
    useMemo(
      () => ({
        uploadFile: async (file: File): Promise<string> => {
          try {
            const { rootPath, openDoc, settings } = useStore.getState()
            if (!rootPath || !openDoc) throw new Error("No vault or doc context")
            const bytes = new Uint8Array(await file.arrayBuffer())
            const mime =
              file.type || guessMimeFromName(file.name) || "application/octet-stream"
            const result = await saveImage({
              bytes,
              mime,
              vaultRoot: rootPath,
              docPath: openDoc.path,
              location: settings.imagesLocation,
              template: settings.imageFilenameTemplate,
            })
            return result.relativePath
          } catch (err) {
            // BlockNote leaves its loading block in place when uploadFile
            // rejects; without this log a paste failure looks identical
            // to a paste still in flight.
            console.error("[image paste] uploadFile failed:", err)
            throw err
          }
        },
        resolveFileUrl: async (stored: string): Promise<string> => {
          if (/^https?:\/\//i.test(stored)) return stored
          if (stored.startsWith("asset:") || stored.startsWith("data:")) return stored
          const { openDoc } = useStore.getState()
          if (!openDoc) return stored
          return convertFileSrc(resolveAgainstDocDir(openDoc.path, stored))
        },
      }),
      [],
    ),
  )

  useEffect(() => {
    if (initializedKey.current === docKey) return
    initializedKey.current = docKey
    ;(async () => {
      const blocks = (await editor.tryParseMarkdownToBlocks(initialMarkdown)) as PartialBlock[]
      editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: "paragraph" }])
      lastEmitted.current = initialMarkdown
    })()
  }, [docKey, initialMarkdown, editor])

  // WKWebView reports clipboard images as types=["Files"] with empty
  // items/files. BlockNote's paste plugin never fires uploadFile, so
  // catch it ourselves and insert via the editor API.
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      const cd = e.clipboardData
      if (!cd) return
      if (cd.items.length > 0 || cd.files.length > 0) return
      if (!Array.from(cd.types).includes("Files")) return
      const { rootPath, openDoc, settings } = useStore.getState()
      if (!rootPath || !openDoc) return
      e.preventDefault()
      try {
        const bytes = await readClipboardImageAsPng()
        if (!bytes) return
        const result = await saveImage({
          bytes,
          mime: "image/png",
          vaultRoot: rootPath,
          docPath: openDoc.path,
          location: settings.imagesLocation,
          template: settings.imageFilenameTemplate,
        })
        const cursor = editor.getTextCursorPosition()
        editor.insertBlocks(
          [{ type: "image", props: { url: result.relativePath } }],
          cursor.block,
          "after",
        )
      } catch (err) {
        console.error("[image paste] clipboard fallback failed:", err)
      }
    }
    document.addEventListener("paste", onPaste, true)
    return () => document.removeEventListener("paste", onPaste, true)
  }, [editor])

  return (
    <div className="h-full overflow-y-auto">
      <BlockNoteView
        editor={editor as BlockNoteEditor}
        theme={theme}
        onChange={async () => {
          const md = await editor.blocksToMarkdownLossy(editor.document)
          if (md !== lastEmitted.current) {
            lastEmitted.current = md
            onChangeMarkdown(md)
          }
        }}
      />
    </div>
  )
}
