import { lazy, Suspense, useState } from "react"
import { useStore } from "../../lib/store"
import { useOpenFile } from "./useOpenFile"
import { useAutoSave } from "./useAutoSave"
import { useEditorMode } from "./useEditorMode"
import { useAutoRename } from "./useAutoRename"
import { basename } from "../../lib/paths"
import { BlockEditor } from "./BlockEditor"
import { renameOpenDoc } from "./renameOpenDoc"
import { Sidebar, Warning, TextAa, Code, Robot } from "@phosphor-icons/react"

// CodeMirror only loads when the user enters raw mode.
const RawEditor = lazy(() =>
  import("./RawEditor").then((m) => ({ default: m.RawEditor })),
)

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length
}

export function EditorPane() {
  useOpenFile()
  useAutoSave()
  useAutoRename()
  const { toggle: toggleMode } = useEditorMode()
  const doc = useStore((s) => s.openDoc)
  const mode = useStore((s) => s.editorMode)
  const setMode = useStore((s) => s.setEditorMode)
  const patch = useStore((s) => s.patchOpenDoc)
  const rightPane = useStore((s) => s.rightPane)
  const toggleRightPane = useStore((s) => s.toggleRightPane)
  const propertiesActive = rightPane === "properties"
  const aiActive = rightPane === "ai"
  const rootPath = useStore((s) => s.rootPath)

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

  // Breadcrumb: vault name → ...subdirs → filename
  const root = rootPath ?? ""
  const rel = doc.path.startsWith(root) ? doc.path.slice(root.length).replace(/^[\\/]+/, "") : doc.path
  const segments = rel.split(/[\\/]/).filter(Boolean)
  const fileName = segments.pop() ?? basename(doc.path)
  const vaultName = root ? basename(root) : ""
  const trailSegments = vaultName ? [vaultName, ...segments] : segments
  const folderTrail = trailSegments.join(" / ")

  // Switch to a target mode without toggling. The toggleMode hook handles the
  // necessary frontmatter ↔ rawMarkdown conversion.
  function setBlock() { if (mode !== "block") toggleMode() }
  function setRaw() { if (mode !== "raw") toggleMode() }
  // Bind setMode for type checker — used only via toggleMode currently.
  void setMode

  return (
    <div className="flex flex-col h-full bg-bg">
      <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
        <div className="flex items-baseline gap-2 min-w-0">
          {folderTrail && (
            <span className="text-[12px] text-text-subtle truncate">{folderTrail} /</span>
          )}
          <EditableFileName fileName={fileName} />
        </div>
        <div className="flex items-center gap-3 flex-none">
          <span className="text-[11px] text-text-subtle">{wordCount(doc.rawMarkdown)} words</span>
          <ModeSegmented mode={mode} onBlock={setBlock} onRaw={setRaw} />
          <button
            onClick={() => toggleRightPane("ai")}
            className={`p-1 rounded transition-colors ${
              aiActive
                ? "text-text bg-elevated"
                : "text-text-subtle hover:text-text hover:bg-elevated"
            }`}
            title={aiActive ? "Hide assistant" : "Show assistant"}
          >
            <Robot size={15} />
          </button>
          <button
            onClick={() => toggleRightPane("properties")}
            className={`p-1 rounded transition-colors ${
              propertiesActive
                ? "text-text bg-elevated"
                : "text-text-subtle hover:text-text hover:bg-elevated"
            }`}
            title={propertiesActive ? "Hide properties" : "Show properties"}
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
          <Suspense fallback={<div className="p-4 text-text-subtle text-sm">Loading raw editor…</div>}>
            <RawEditor
              value={doc.rawMarkdown}
              onChange={(next) => patch({ rawMarkdown: next, dirty: true })}
            />
          </Suspense>
        )}
      </div>
    </div>
  )
}

function EditableFileName({ fileName }: { fileName: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const dotIdx = fileName.lastIndexOf(".")
  const stem = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName
  const ext = dotIdx > 0 ? fileName.slice(dotIdx) : ""

  function begin() {
    setDraft(stem)
    setEditing(true)
  }

  async function commit() {
    const trimmed = draft.trim()
    setEditing(false)
    if (!trimmed || trimmed === stem) return
    try {
      await renameOpenDoc(trimmed)
    } catch (e) {
      // Keep the prior name visible; surface details in the console.
      console.error("breadcrumb rename failed", e)
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit() }
          if (e.key === "Escape") { e.preventDefault(); setEditing(false) }
        }}
        onClick={(e) => e.stopPropagation()}
        aria-label="Rename file"
        title={fileName}
        className="text-[14px] font-medium text-text bg-elevated border border-border-strong rounded px-1 -mx-1 outline-none min-w-0"
        style={{ width: `${Math.max(draft.length + 1, 4)}ch` }}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={begin}
      title={ext ? `Rename (${ext.slice(1)})` : "Rename"}
      className="text-[14px] font-medium text-text truncate cursor-text hover:bg-elevated rounded px-1 -mx-1 text-left"
    >
      {stem}
    </button>
  )
}

function ModeSegmented({
  mode, onBlock, onRaw,
}: { mode: "block" | "raw"; onBlock: () => void; onRaw: () => void }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-surface p-0.5" role="tablist">
      <SegBtn
        active={mode === "block"}
        onClick={onBlock}
        title="Block view (⌘E)"
        ariaLabel="Block view"
      >
        <TextAa size={13} weight="bold" />
      </SegBtn>
      <SegBtn
        active={mode === "raw"}
        onClick={onRaw}
        title="Raw markdown (⌘E)"
        ariaLabel="Raw markdown"
      >
        <Code size={13} weight="bold" />
      </SegBtn>
    </div>
  )
}

function SegBtn({
  active, onClick, title, ariaLabel, children,
}: {
  active: boolean
  onClick: () => void
  title: string
  ariaLabel: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      onClick={onClick}
      title={title}
      className={[
        "flex items-center justify-center w-7 h-6 rounded transition-colors",
        active
          ? "bg-accent text-accent-fg"
          : "text-text-subtle hover:text-text hover:bg-elevated",
      ].join(" ")}
    >
      {children}
    </button>
  )
}
