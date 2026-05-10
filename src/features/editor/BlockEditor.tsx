import { useEffect, useMemo, useRef } from "react"
import type { BlockNoteEditor, PartialBlock } from "@blocknote/core"
import { useCreateBlockNote } from "@blocknote/react"
import { BlockNoteView } from "@blocknote/mantine"
import "@blocknote/mantine/style.css"
import { convertFileSrc } from "@tauri-apps/api/core"
import { useResolvedTheme } from "../settings/useTheme"
import { useStore } from "../../lib/store"
import { saveImage, guessMimeFromName } from "../../lib/imagePaste"

function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"))
  return idx <= 0 ? "" : p.slice(0, idx)
}

function resolveAgainstDocDir(docPath: string, rel: string): string {
  if (rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel)) return rel
  const sep = docPath.includes("\\") ? "\\" : "/"
  const segs = [
    ...parentDir(docPath).split(/[\\/]/).filter(Boolean),
    ...rel.split("/").filter(Boolean),
  ]
  const stack: string[] = []
  for (const s of segs) {
    if (s === "..") stack.pop()
    else if (s !== ".") stack.push(s)
  }
  const prefix = docPath.startsWith("/") ? "/" : ""
  return prefix + stack.join(sep)
}

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

  // Refs so the BlockNote callbacks (created once below) always see
  // the latest doc path, vault root, and settings.
  const docPathRef = useRef(docKey)
  docPathRef.current = docKey

  const vaultRoot = useStore((s) => s.rootPath)
  const imagesLocation = useStore((s) => s.settings.imagesLocation)
  const imageFilenameTemplate = useStore((s) => s.settings.imageFilenameTemplate)
  const vaultRootRef = useRef(vaultRoot)
  vaultRootRef.current = vaultRoot
  const locationRef = useRef(imagesLocation)
  locationRef.current = imagesLocation
  const templateRef = useRef(imageFilenameTemplate)
  templateRef.current = imageFilenameTemplate

  const editor = useCreateBlockNote(
    useMemo(
      () => ({
        uploadFile: async (file: File): Promise<string> => {
          const root = vaultRootRef.current
          const docPath = docPathRef.current
          if (!root || !docPath) throw new Error("No vault or doc context")
          const bytes = new Uint8Array(await file.arrayBuffer())
          const mime = file.type || guessMimeFromName(file.name) || "application/octet-stream"
          const result = await saveImage({
            bytes,
            mime,
            vaultRoot: root,
            docPath,
            location: locationRef.current,
            template: templateRef.current,
          })
          return result.relativePath
        },
        resolveFileUrl: async (stored: string): Promise<string> => {
          if (/^https?:\/\//i.test(stored)) return stored
          if (stored.startsWith("asset:") || stored.startsWith("data:")) return stored
          const absolute = resolveAgainstDocDir(docPathRef.current, stored)
          return convertFileSrc(absolute)
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
