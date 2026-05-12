import { useStore } from "../../lib/store"
import { TreeNodeView } from "./TreeNode"
import { useTreeActions } from "./useTreeActions"
import { useRootDnd } from "./useTreeDnd"
import { useDragScroll } from "./useDragScroll"
import { FilePlus, FolderPlus } from "@phosphor-icons/react"

export function TreePane() {
  const tree = useStore((s) => s.tree)
  const rootPath = useStore((s) => s.rootPath)
  const actions = useTreeActions()
  const rootDnd = useRootDnd()
  const dragScroll = useDragScroll()
  if (!tree) return null

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-end gap-1 px-2 py-1.5">
        <button
          onClick={() => rootPath && actions.newFile(rootPath)}
          className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated transition-colors"
          title="New file at root"
        >
          <FilePlus size={13} />
        </button>
        <button
          onClick={() => rootPath && actions.newFolder(rootPath)}
          className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated transition-colors"
          title="New folder at root"
        >
          <FolderPlus size={13} />
        </button>
      </div>
      <div
        ref={dragScroll.ref}
        className={[
          "flex-1 overflow-y-auto pb-1.5 px-1 text-[13px]",
          rootDnd.isDropTarget ? "outline outline-1 outline-accent -outline-offset-1 rounded-sm" : "",
        ].join(" ")}
        // Capture-phase so per-row stopPropagation doesn't suppress autoscroll.
        onDragOverCapture={dragScroll.onDragOver}
        onDragOver={rootDnd.onDragOver}
        onDragLeave={rootDnd.onDragLeave}
        onDrop={rootDnd.onDrop}
      >
        {tree.kind === "dir" && tree.children.map((c) => (
          <TreeNodeView key={c.path} node={c} />
        ))}
        {/* Empty-space drop region so drops below the last row hit the vault root */}
        <div className="h-12" aria-hidden="true" />
      </div>
    </div>
  )
}
