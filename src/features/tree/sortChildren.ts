import type { TreeNode } from "../../lib/ipc"

export type FolderSortKey = "name" | "added"
export type FolderSortDir = "asc" | "desc"

/** How one folder orders its files. Folders themselves always sort first, A→Z. */
export type FolderSortPref = { key: FolderSortKey; dir: FolderSortDir }

/** Issue #65: folders with no stored preference show newest files first. */
export const DEFAULT_FOLDER_SORT: FolderSortPref = { key: "added", dir: "desc" }

export function sameSort(a: FolderSortPref, b: FolderSortPref): boolean {
  return a.key === b.key && a.dir === b.dir
}

type FileNode = Extract<TreeNode, { kind: "file" }>

/** "Date added", best available: birth time, else mtime, else epoch. */
function addedSecs(node: FileNode): number {
  return node.created ?? node.mtime ?? 0
}

// Case-insensitive, with the raw name as a deterministic final tie-break.
function compareNames(a: TreeNode, b: TreeNode): number {
  const folded = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  return folded !== 0 ? folded : a.name.localeCompare(b.name)
}

/**
 * Order one folder's children for display: dirs first (A→Z, always), then
 * files by the folder's preference (default: date added, newest first).
 * Pure — returns a new array.
 */
export function sortChildren(
  children: readonly TreeNode[],
  pref?: FolderSortPref,
): TreeNode[] {
  const { key, dir } = pref ?? DEFAULT_FOLDER_SORT
  const sign = dir === "asc" ? 1 : -1
  const dirs = children.filter((c) => c.kind === "dir").sort(compareNames)
  const files = children
    .filter((c): c is FileNode => c.kind === "file")
    .sort((a, b) => {
      if (key === "added") {
        const diff = addedSecs(a) - addedSecs(b)
        if (diff !== 0) return sign * diff
        return compareNames(a, b)
      }
      return sign * compareNames(a, b)
    })
  return [...dirs, ...files]
}
