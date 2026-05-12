import { useStore } from "../../lib/store"
import { TreeNodeView } from "./TreeNode"
import { useTreeActions } from "./useTreeActions"
import { useRootDnd } from "./useTreeDnd"
import { useDragScroll } from "./useDragScroll"
import { targetParentDir } from "./targetDir"
import { FilePlus, FolderPlus } from "@phosphor-icons/react"

export function TreePane() {
  const tree = useStore((s) => s.tree)
  const rootPath = useStore((s) => s.rootPath)
  const selectedPath = useStore((s) => s.selectedPath)
  const actions = useTreeActions()
  const rootDnd = useRootDnd()
  const dragScroll = useDragScroll()
  if (!tree) return null

  const target = targetParentDir(tree, selectedPath, rootPath)
  const inSubfolder = !!target && target !== rootPath

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-end gap-1 px-2 py-1.5">
        <button
          onClick={() => target && actions.newFile(target)}
          className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated transition-colors"
          title={inSubfolder ? "New file in selected folder" : "New file at root"}
        >
          <FilePlus size={13} />
        </button>
        <button
          onClick={() => target && actions.newFolder(target)}
          className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated transition-colors"
          title={inSubfolder ? "New folder in selected folder" : "New folder at root"}
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
