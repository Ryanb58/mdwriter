import { useStore } from "../../lib/store"
import { useOpenFile } from "./useOpenFile"
import { basename } from "../../lib/paths"
import { BlockEditor } from "./BlockEditor"

export function EditorPane() {
  useOpenFile()
  const doc = useStore((s) => s.openDoc)
  const patch = useStore((s) => s.patchOpenDoc)

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center opacity-60">
        Select a file or create a new one
      </div>
    )
  }
  if (doc.parseError) {
    return (
      <div className="p-4 text-red-500">
        <div className="font-semibold mb-2">Failed to open: {basename(doc.path)}</div>
        <div className="text-sm">{doc.parseError}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 py-2 text-sm flex items-center justify-between">
        <span className="font-medium truncate">{basename(doc.path)}</span>
        <span className="opacity-50 text-xs">{doc.rawMarkdown.split(/\s+/).filter(Boolean).length} words</span>
      </div>
      <div className="flex-1 overflow-auto">
        <BlockEditor
          docKey={doc.path}
          initialMarkdown={doc.rawMarkdown}
          onChangeMarkdown={(md) => patch({ rawMarkdown: md, dirty: true })}
        />
      </div>
    </div>
  )
}
