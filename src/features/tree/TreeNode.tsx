import { useState } from "react"
import { CaretRight, CaretDown, FileText, Folder } from "@phosphor-icons/react"
import type { TreeNode as TN } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { useTreeActions } from "./useTreeActions"
import { TreeContextMenu } from "./TreeContextMenu"
import { parent, basename } from "../../lib/paths"

export function TreeNodeView({ node, depth = 0 }: { node: TN; depth?: number }) {
  const [expanded, setExpanded] = useState(true)
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

  const rowStyle = { paddingLeft: depth * 12 + (isDir ? 4 : 18) }
  const selected = !isDir && selectedPath === node.path

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-1 py-0.5 rounded ${selected ? "bg-blue-600 text-white" : "hover:bg-neutral-800"}`}
        style={rowStyle}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
        onClick={() => isDir ? setExpanded((x) => !x) : useStore.setState({ selectedPath: node.path })}
      >
        {isDir && (expanded ? <CaretDown size={12} /> : <CaretRight size={12} />)}
        {isDir ? <Folder size={14} /> : <FileText size={14} />}
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
            className="flex-1 bg-neutral-800 px-1 outline-none rounded"
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
      </div>
      {isDir && expanded && (node as Extract<TN, { kind: "dir" }>).children.map((c) => (
        <TreeNodeView key={c.path} node={c} depth={depth + 1} />
      ))}
      {menu && <TreeContextMenu x={menu.x} y={menu.y} actions={menuActions} onClose={() => setMenu(null)} />}
    </div>
  )
}
