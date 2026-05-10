import { useStore } from "../../lib/store"
import { TreeNodeView } from "./TreeNode"

export function TreePane() {
  const tree = useStore((s) => s.tree)
  const rootPath = useStore((s) => s.rootPath)
  if (!tree) return null
  return (
    <div className="h-full overflow-y-auto p-2 text-sm">
      <div className="text-xs uppercase opacity-50 px-1 pb-1 truncate">{rootPath?.split(/[\\/]/).pop()}</div>
      {tree.kind === "dir" && tree.children.map((c) => (
        <TreeNodeView key={c.path} node={c} />
      ))}
    </div>
  )
}
