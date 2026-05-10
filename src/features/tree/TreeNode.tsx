import { useState } from "react"
import { CaretRight, CaretDown, FileText, Folder, FolderOpen } from "@phosphor-icons/react"
import type { TreeNode as TN } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { useTreeActions } from "./useTreeActions"
import { TreeContextMenu } from "./TreeContextMenu"
import { parent, basename } from "../../lib/paths"

export function TreeNodeView({ node, depth = 0 }: { node: TN; depth?: number }) {
  const [expanded, setExpanded] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(node.name)
  const selectedPath = useStore((s) => s.selectedPath)
  const actions = useTreeActions()

  function commitRename() {
    if (draftName && draftName !== node.name) actions.rename(node.path, draftName).catch(console.error)
    setRenaming(false)
  }

  const isDir = node.kind === "dir"
  const parentDir = isDir ? node.path : parent(node.path)

  const menuActions = [
    ...(isDir ? [
      { label: "New file", onClick: () => actions.newFile(parentDir) },
      { label: "New folder", onClick: () => actions.newFolder(parentDir) },
    ] : []),
    { label: "Rename", onClick: () => { setDraftName(basename(node.path)); setRenaming(true) } },
    { label: "Delete", onClick: () => {
      if (confirm(`Move "${node.name}" to trash?`)) actions.trash(node.path).catch(console.error)
    }},
  ]

  // Visual nesting via per-row guide lines + indent
  const indent = depth * 12
  const selected = !isDir && selectedPath === node.path

  // Strip extension from display name for files (cleaner)
  const displayName = !isDir && /\.(md|markdown)$/i.test(node.name)
    ? node.name.replace(/\.(md|markdown)$/i, "")
    : node.name

  return (
    <div>
      <div
        className={[
          "group relative flex items-center gap-1.5 px-2 py-[3px] rounded-md cursor-pointer select-none",
          "transition-colors",
          selected
            ? "bg-accent-soft text-text"
            : "hover:bg-elevated text-text-muted hover:text-text",
        ].join(" ")}
        style={{ paddingLeft: 8 + indent }}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
        onClick={() => isDir ? setExpanded((x) => !x) : useStore.setState({ selectedPath: node.path })}
        onDoubleClick={(e) => {
          e.preventDefault()
          if (renaming) return
          setDraftName(basename(node.path))
          setRenaming(true)
        }}
      >
        {isDir ? (
          expanded
            ? <CaretDown size={11} weight="bold" className="text-text-subtle flex-none" />
            : <CaretRight size={11} weight="bold" className="text-text-subtle flex-none" />
        ) : (
          <span className="w-[11px] flex-none" />
        )}
        {isDir
          ? (expanded ? <FolderOpen size={14} weight="duotone" className="text-text-subtle flex-none" /> : <Folder size={14} weight="duotone" className="text-text-subtle flex-none" />)
          : <FileText size={13} weight="regular" className="text-text-subtle flex-none" />}
        {renaming ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename()
              if (e.key === "Escape") setRenaming(false)
            }}
            className="flex-1 min-w-0 bg-elevated border border-border-strong rounded px-1 py-px text-[13px]"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={`truncate ${selected ? "font-medium" : ""}`}>{displayName}</span>
        )}
      </div>
      {isDir && expanded && (node as Extract<TN, { kind: "dir" }>).children.map((c) => (
        <TreeNodeView key={c.path} node={c} depth={depth + 1} />
      ))}
      {menu && <TreeContextMenu x={menu.x} y={menu.y} actions={menuActions} onClose={() => setMenu(null)} />}
    </div>
  )
}
