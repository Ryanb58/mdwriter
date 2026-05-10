import { useEffect, useRef } from "react"
import type { BlockNoteEditor, PartialBlock } from "@blocknote/core"
import { useCreateBlockNote } from "@blocknote/react"
import { BlockNoteView } from "@blocknote/mantine"
import "@blocknote/mantine/style.css"

export function BlockEditor({
  initialMarkdown,
  onChangeMarkdown,
  docKey,
}: {
  initialMarkdown: string
  onChangeMarkdown: (md: string) => void
  docKey: string
}) {
  const editor = useCreateBlockNote()
  const initializedKey = useRef<string | null>(null)
  const lastEmitted = useRef<string>("")

  useEffect(() => {
    if (initializedKey.current === docKey) return
    initializedKey.current = docKey
    ;(async () => {
      const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdown) as PartialBlock[]
      editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: "paragraph" }])
      lastEmitted.current = initialMarkdown
    })()
  }, [docKey, initialMarkdown, editor])

  return (
    <div className="h-full overflow-y-auto">
      <BlockNoteView
        editor={editor as BlockNoteEditor}
        theme="dark"
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
