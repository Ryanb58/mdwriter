import { useStore } from "../../lib/store"
import { useOpenFile } from "./useOpenFile"
import { useAutoSave } from "./useAutoSave"
import { useEditorMode } from "./useEditorMode"
import { basename } from "../../lib/paths"
import { BlockEditor } from "./BlockEditor"
import { RawEditor } from "./RawEditor"

export function EditorPane() {
  useOpenFile()
  useAutoSave()
  useEditorMode()
  const doc = useStore((s) => s.openDoc)
  const mode = useStore((s) => s.editorMode)
  const patch = useStore((s) => s.patchOpenDoc)

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center opacity-60">
        Select a file or create a new one
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 py-2 text-sm flex items-center justify-between">
        <span className="font-medium truncate">{basename(doc.path)}</span>
        <span className="opacity-50 text-xs">
          {mode === "raw" ? "RAW" : "BLOCK"} · {doc.rawMarkdown.split(/\s+/).filter(Boolean).length} words
        </span>
      </div>
      {doc.parseError && (
        <div className="bg-red-900/40 border-b border-red-700 px-4 py-2 text-sm">
          Couldn't parse frontmatter — fix in raw mode (Cmd+E to toggle).
          <div className="opacity-70">{doc.parseError}</div>
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {mode === "block" ? (
          <BlockEditor
            docKey={doc.path}
            initialMarkdown={doc.rawMarkdown}
            onChangeMarkdown={(md) => patch({ rawMarkdown: md, dirty: true })}
          />
        ) : (
          <RawEditor
            value={doc.rawMarkdown}
            onChange={(next) => patch({ rawMarkdown: next, dirty: true })}
          />
        )}
      </div>
    </div>
  )
}
