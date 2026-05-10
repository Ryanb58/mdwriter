import { useStore } from "../../lib/store"
import { TreeNodeView } from "./TreeNode"
import { useTreeActions } from "./useTreeActions"
import { Plus } from "@phosphor-icons/react"

export function TreePane() {
  const tree = useStore((s) => s.tree)
  const rootPath = useStore((s) => s.rootPath)
  const actions = useTreeActions()
  if (!tree) return null

  const folderName = rootPath?.split(/[\\/]/).filter(Boolean).pop() ?? ""

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="text-[11px] uppercase tracking-[0.14em] text-text-subtle truncate" title={rootPath ?? ""}>
          {folderName}
        </div>
        <button
          onClick={() => rootPath && actions.newFile(rootPath)}
          className="text-text-subtle hover:text-text transition-colors"
          title="New file"
        >
          <Plus size={14} weight="bold" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 px-1 text-[13px]">
        {tree.kind === "dir" && tree.children.map((c) => (
          <TreeNodeView key={c.path} node={c} />
        ))}
      </div>
    </div>
  )
}
