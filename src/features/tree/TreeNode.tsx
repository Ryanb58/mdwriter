import { useEffect, useState } from "react"
import {
  CaretRight, CaretDown, FileText, Folder, FolderOpen,
  FilePlus, FolderPlus, PencilSimple, TrashSimple, Copy,
  PushPinSimple, PushPinSimpleSlash,
} from "@phosphor-icons/react"
import type { TreeNode as TN } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { useTreeActions } from "./useTreeActions"
import { TreeContextMenu, type ContextActionGroup } from "./TreeContextMenu"
import { isMarkdown, parent, relativeTo } from "../../lib/paths"
import { handleRowClick } from "./selection"
import { useRowDnd } from "./useTreeDnd"
import { loadDirectory } from "./treeLoader"

export function TreeNodeView({ node, depth = 0 }: { node: TN; depth?: number }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(node.name)
  const rootPath = useStore((s) => s.rootPath)
  const selectedPath = useStore((s) => s.selectedPath)
  const selectedPaths = useStore((s) => s.selectedPaths)
  const expandedFolders = useStore((s) => s.expandedFolders)
  const loading = useStore((s) => s.loadingFolders.has(node.path))
  const loadError = useStore((s) => s.folderLoadErrors[node.path] ?? null)
  const toggleFolderExpanded = useStore((s) => s.toggleFolderExpanded)
  const renamingPath = useStore((s) => s.renamingPath)
  const pinnedPaths = useStore((s) => s.pinnedPaths)
  const togglePinnedPath = useStore((s) => s.togglePinnedPath)
  const actions = useTreeActions()
  const isDir = node.kind === "dir"
  const canPin = !isDir && isMarkdown(node.path)
  const pinned = canPin && pinnedPaths.includes(node.path)
  const expanded = isDir && expandedFolders.has(node.path)
  const inSelection = selectedPaths.has(node.path)
  const dnd = useRowDnd(node)

  // Strip .md/.markdown from display and rename-input; extension is re-appended in useTreeActions.rename
  const displayName = !isDir && /\.(md|markdown)$/i.test(node.name)
    ? node.name.replace(/\.(md|markdown)$/i, "")
    : node.name

  // Global F2 — when this row is the selected file, the keyboard handler in
  // useTreeShortcuts sets `renamingPath` to its path; we react to that here.
  useEffect(() => {
    if (renamingPath === node.path && !renaming) {
      setDraftName(displayName)
      setRenaming(true)
      useStore.getState().setRenamingPath(null)
    }
  }, [renamingPath, node.path, renaming, displayName])

  function commitRename() {
    if (draftName && draftName !== displayName) actions.rename(node.path, draftName).catch(console.error)
    setRenaming(false)
  }

  const parentDir = isDir ? node.path : parent(node.path)

  const menuGroups: ContextActionGroup[] = [
    ...(isDir
      ? [[
          {
            label: "New file",
            onClick: () => actions.newFile(parentDir),
            icon: <FilePlus size={14} />,
          },
          {
            label: "New folder",
            onClick: () => actions.newFolder(parentDir),
            icon: <FolderPlus size={14} />,
          },
        ]]
      : []),
    [
      ...(canPin
        ? [{
            label: pinned ? "Unpin file" : "Pin file",
            onClick: () => togglePinnedPath(node.path),
            icon: pinned ? <PushPinSimpleSlash size={14} /> : <PushPinSimple size={14} />,
          }]
        : []),
      {
        label: "Copy path",
        onClick: () => {
          navigator.clipboard.writeText(node.path).catch(console.error)
        },
        icon: <Copy size={14} />,
      },
      {
        label: "Copy relative path",
        onClick: () => {
          const rel = rootPath ? relativeTo(rootPath, node.path) : node.path
          navigator.clipboard.writeText(rel).catch(console.error)
        },
        icon: <Copy size={14} />,
      },
    ],
    [
      {
        label: "Rename",
        onClick: () => { setDraftName(displayName); setRenaming(true) },
        icon: <PencilSimple size={14} />,
        shortcut: "F2",
      },
    ],
    [
      {
        label: selectedPaths.size > 1 && inSelection
          ? `Move ${selectedPaths.size} items to Trash`
          : "Move to Trash",
        onClick: () => {
          if (selectedPaths.size > 1 && inSelection) {
            const paths = Array.from(selectedPaths)
            if (confirm(`Move ${paths.length} items to trash?`)) {
              actions.trashMany(paths).catch(console.error)
            }
          } else if (confirm(`Move "${node.name}" to trash?`)) {
            actions.trash(node.path).catch(console.error)
          }
        },
        icon: <TrashSimple size={14} />,
        shortcut: "⌫",
        danger: true,
      },
    ],
  ]

  // Visual nesting via per-row guide lines + indent
  const indent = depth * 12
  const isAnchor = selectedPath === node.path
  const fileSelected = !isDir && inSelection
  const dirSelected = isDir && inSelection

  return (
    <div>
      <div
        className={[
          "group relative flex items-center gap-1.5 px-2 py-[3px] rounded-md cursor-pointer select-none",
          "transition-[color,background-color,opacity] duration-150",
          fileSelected || dirSelected
            ? "bg-accent-soft text-text"
            : "hover:bg-elevated text-text-muted hover:text-text",
          dnd.isDropTarget ? "ring-1 ring-accent" : "",
          dnd.isDragging ? "opacity-50" : "",
        ].join(" ")}
        style={{ paddingLeft: 8 + indent }}
        draggable={!renaming}
        onDragStart={dnd.onDragStart}
        onDragEnd={dnd.onDragEnd}
        onDragOver={dnd.onDragOver}
        onDragLeave={dnd.onDragLeave}
        onDrop={dnd.onDrop}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
        onClick={(e) => {
          // Plain click on a folder both replaces the selection (matching the
          // file-click contract) and toggles expansion. Modifier clicks defer
          // to handleRowClick so cmd/shift behavior stays consistent.
          handleRowClick(node.path, {
            meta: e.metaKey || e.ctrlKey,
            shift: e.shiftKey,
          })
          if (isDir && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
            const opening = !expanded
            toggleFolderExpanded(node.path, opening)
            if (opening && !node.loaded) void loadDirectory(node.path)
          }
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          if (renaming) return
          setDraftName(displayName)
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
          <span className={`min-w-0 flex-1 truncate ${isAnchor ? "font-medium" : ""}`} title={displayName}>{displayName}</span>
        )}
        {canPin && !renaming && (
          <button
            type="button"
            className={[
              "ml-auto flex-none rounded p-0.5 transition-colors",
              pinned
                ? "text-text-subtle opacity-100 hover:bg-elevated hover:text-text"
                : "text-text-subtle opacity-0 hover:bg-elevated hover:text-text group-hover:opacity-100",
            ].join(" ")}
            title={pinned ? "Unpin file" : "Pin file"}
            aria-label={pinned ? `Unpin ${displayName}` : `Pin ${displayName}`}
            onClick={(e) => {
              e.stopPropagation()
              togglePinnedPath(node.path)
            }}
          >
            {pinned ? <PushPinSimpleSlash size={12} /> : <PushPinSimple size={12} />}
          </button>
        )}
      </div>
      {isDir && expanded && loading && (
        <div
          className="py-1 text-[11px] text-text-subtle"
          style={{ paddingLeft: 28 + indent }}
        >
          Loading…
        </div>
      )}
      {isDir && expanded && !loading && loadError && (
        <div
          className="flex items-center gap-2 py-1 text-[11px] text-danger"
          style={{ paddingLeft: 28 + indent }}
        >
          <span className="truncate">{loadError}</span>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-text-muted hover:bg-elevated hover:text-text"
            onClick={() => { void loadDirectory(node.path) }}
          >
            Retry
          </button>
        </div>
      )}
      {isDir && expanded && (node as Extract<TN, { kind: "dir" }>).children.map((c) => (
        <TreeNodeView key={c.path} node={c} depth={depth + 1} />
      ))}
      {menu && <TreeContextMenu x={menu.x} y={menu.y} groups={menuGroups} onClose={() => setMenu(null)} />}
    </div>
  )
}
