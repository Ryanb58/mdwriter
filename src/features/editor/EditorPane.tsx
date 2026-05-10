import { useStore } from "../../lib/store"
import { useOpenFile } from "./useOpenFile"
import { useAutoSave } from "./useAutoSave"
import { useEditorMode } from "./useEditorMode"
import { basename } from "../../lib/paths"
import { BlockEditor } from "./BlockEditor"
import { RawEditor } from "./RawEditor"
import { Sidebar, Warning } from "@phosphor-icons/react"

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

export function EditorPane() {
  useOpenFile()
  useAutoSave()
  useEditorMode()
  const doc = useStore((s) => s.openDoc)
  const mode = useStore((s) => s.editorMode)
  const patch = useStore((s) => s.patchOpenDoc)
  const propertiesVisible = useStore((s) => s.propertiesVisible)
  const toggleProperties = useStore((s) => s.toggleProperties)

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        <div className="text-center">
          <p className="text-sm mb-2">Select a file or create a new one.</p>
          <p className="text-xs text-text-subtle">
            <kbd className="font-mono px-1.5 py-0.5 rounded border border-border bg-surface">⌘P</kbd>
            <span className="mx-2">to open</span>
          </p>
        </div>
      </div>
    )
  }

  // Build a thin breadcrumb from path segments relative to the workspace root
  const root = useStore.getState().rootPath ?? ""
  const rel = doc.path.startsWith(root) ? doc.path.slice(root.length).replace(/^[\\/]+/, "") : doc.path
  const segments = rel.split(/[\\/]/).filter(Boolean)
  const fileName = segments.pop() ?? basename(doc.path)
  const folderTrail = segments.join(" / ")

  return (
    <div className="flex flex-col h-full bg-bg">
      <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
        <div className="flex items-baseline gap-2 min-w-0">
          {folderTrail && (
            <span className="text-[12px] text-text-subtle truncate">{folderTrail} /</span>
          )}
          <span className="text-[14px] font-medium text-text truncate">{fileName}</span>
        </div>
        <div className="flex items-center gap-3 flex-none">
          <span className="text-[11px] uppercase tracking-[0.14em] text-text-subtle">
            {mode === "raw" ? "raw" : "block"}
          </span>
          <span className="text-[11px] text-text-subtle">{wordCount(doc.rawMarkdown)} words</span>
          <button
            onClick={toggleProperties}
            className={`text-text-subtle hover:text-text transition-colors ${propertiesVisible ? "text-text" : ""}`}
            title={propertiesVisible ? "Hide properties" : "Show properties"}
          >
            <Sidebar size={15} />
          </button>
        </div>
      </div>
      {doc.parseError && (
        <div className="flex items-start gap-2 border-b border-border bg-danger/10 text-danger px-5 py-2 text-[13px]">
          <Warning size={14} className="flex-none mt-0.5" />
          <div className="min-w-0">
            <div>Couldn't parse frontmatter. Edit it in raw mode (<span className="font-mono">⌘E</span>).</div>
            <div className="text-[11px] opacity-80 truncate">{doc.parseError}</div>
          </div>
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

