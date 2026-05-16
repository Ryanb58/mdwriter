import { lazy, Suspense, useState } from "react"
import { useStore } from "../../lib/store"
import { useOpenFile } from "./useOpenFile"
import { useAutoSave } from "./useAutoSave"
import { useEditorMode } from "./useEditorMode"
import { useAutoRename } from "./useAutoRename"
import { BlockEditor } from "./BlockEditor"
import { renameOpenDoc } from "./renameOpenDoc"
import { buildBreadcrumbTrail, type BreadcrumbFolder } from "./breadcrumbTrail"
import { Sidebar, Warning, TextAa, Code, Robot, NotePencil, FolderOpen, MagnifyingGlass } from "@phosphor-icons/react"
import { useLayout } from "../../layout/LayoutShell"
import { isOverlayMode } from "../../layout/constants"
import { openPalette } from "../palette/openPalette"
import { createNewFile } from "../tree/useTreeActions"
import { targetParentDir } from "../tree/targetDir"

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
  const editorView = useStore((s) => s.editorMode)
  const setEditorView = useStore((s) => s.setEditorMode)
  const patch = useStore((s) => s.patchOpenDoc)
  const rightPaneTab = useStore((s) => s.rightPaneTab)
  const setRightPaneTab = useStore((s) => s.setRightPaneTab)
  const rootPath = useStore((s) => s.rootPath)
  const { rightState, mode: layoutMode, setPanelState } = useLayout()
  const rightOpen = rightState === "open"
  const propertiesActive = rightOpen && rightPaneTab === "properties"
  const aiActive = rightOpen && rightPaneTab === "ai"

  function activateTab(tab: "properties" | "ai") {
    // Click on an already-active tab collapses the panel. Click on the other
    // tab switches the tab and ensures the panel is visible.
    if (rightOpen && rightPaneTab === tab) {
      setPanelState("right", isOverlayMode(layoutMode) ? "closed" : "rail")
      return
    }
    setRightPaneTab(tab)
    setPanelState("right", "open")
  }

  if (!doc) {
    return <EmptyEditorState />
  }

  // Breadcrumb: vault name → ...subdirs → filename. Subdir segments are
  // clickable — they reveal the folder in the tree sidebar.
  const { vaultName, folders, fileName } = buildBreadcrumbTrail(rootPath, doc.path)

  // Switch to a target mode without toggling. The toggleMode hook handles the
  // necessary frontmatter ↔ rawMarkdown conversion.
  function setBlock() { if (editorView !== "block") toggleMode() }
  function setRaw() { if (editorView !== "raw") toggleMode() }
  // Bind setter for type checker — used only via toggleMode currently.
  void setEditorView

  return (
    <div className="flex flex-col h-full bg-bg">
      <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
        <div className="flex items-baseline gap-2 min-w-0">
          <FolderBreadcrumb vaultName={vaultName} folders={folders} />
          <EditableFileName fileName={fileName} />
        </div>
        <div className="flex items-center gap-3 flex-none">
          <span className="text-[11px] text-text-subtle">{wordCount(doc.rawMarkdown)} words</span>
          <ModeSegmented mode={editorView} onBlock={setBlock} onRaw={setRaw} />
          <button
            onClick={() => activateTab("ai")}
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
            onClick={() => activateTab("properties")}
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
        {editorView === "block" ? (
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

function EmptyEditorState() {
  const tree = useStore((s) => s.tree)
  const selectedPath = useStore((s) => s.selectedPath)
  const rootPath = useStore((s) => s.rootPath)

  async function newNote() {
    const target = targetParentDir(tree, selectedPath, rootPath)
    if (!target) return
    try {
      await createNewFile(target)
    } catch (e) {
      console.error("new note failed", e)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="w-full max-w-2xl px-8">
        <p className="text-[12px] text-text-subtle text-center mb-6">
          Nothing open. Pick where to start.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickAction
            icon={<NotePencil size={20} />}
            label="New note"
            hint="⌘N"
            onClick={newNote}
          />
          <QuickAction
            icon={<FolderOpen size={20} />}
            label="Open recent"
            hint="⌘P"
            onClick={() => openPalette("file")}
          />
          <QuickAction
            icon={<MagnifyingGlass size={20} />}
            label="Search"
            hint="⌘⇧F"
            onClick={() => openPalette("search")}
          />
        </div>
      </div>
    </div>
  )
}

function QuickAction({
  icon, label, hint, onClick,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-lg border border-border bg-surface px-4 py-4 text-left transition-colors hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="text-text-subtle group-hover:text-text transition-colors">{icon}</span>
      <span className="flex items-baseline justify-between w-full gap-2">
        <span className="text-[13px] font-medium text-text">{label}</span>
        <kbd className="font-mono text-[10px] text-text-subtle border border-border rounded px-1.5 py-0.5 group-hover:border-border-strong">
          {hint}
        </kbd>
      </span>
    </button>
  )
}

function FolderBreadcrumb({
  vaultName, folders,
}: { vaultName: string; folders: BreadcrumbFolder[] }) {
  if (!vaultName && folders.length === 0) return null

  function revealInTree(index: number) {
    const target = folders[index]
    if (!target) return
    const { toggleFolderExpanded, setSelected } = useStore.getState()
    // Expand every ancestor up to and including the clicked folder so the
    // row is actually visible after we select it.
    for (let i = 0; i <= index; i++) {
      toggleFolderExpanded(folders[i].path, true)
    }
    setSelected(target.path)
  }

  return (
    <span className="text-[12px] text-text-subtle truncate min-w-0">
      {vaultName && <span>{vaultName}</span>}
      {vaultName && folders.length > 0 && <span aria-hidden> / </span>}
      {folders.map((seg, i) => (
        <span key={seg.path}>
          <button
            type="button"
            onClick={() => revealInTree(i)}
            title={`Reveal "${seg.name}" in sidebar`}
            className="hover:text-text hover:underline rounded"
          >
            {seg.name}
          </button>
          {i < folders.length - 1 && <span aria-hidden> / </span>}
        </span>
      ))}
      <span aria-hidden> /</span>
    </span>
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
