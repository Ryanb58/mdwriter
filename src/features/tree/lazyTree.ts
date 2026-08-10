import type { TreeNode } from "../../lib/ipc"
import { pathIsWithin } from "../../lib/openDocumentPaths"
import { parent } from "../../lib/paths"

export function replaceDirectory(
  tree: TreeNode | null,
  listing: TreeNode,
): TreeNode | null {
  if (!tree || listing.kind !== "dir") return tree

  if (tree.path === listing.path) {
    if (tree.kind !== "dir") return tree
    const existingByPath = new Map(tree.children.map((child) => [child.path, child]))
    const children = listing.children.map((child) => {
      const existing = existingByPath.get(child.path)
      if (
        existing?.kind === "dir" &&
        child.kind === "dir" &&
        existing.loaded
      ) {
        return { ...child, children: existing.children, loaded: true }
      }
      return child
    })
    return { ...listing, children }
  }

  if (tree.kind !== "dir") return tree
  let changed = false
  const children = tree.children.map((child) => {
    const next = replaceDirectory(child, listing)
    if (next !== child) changed = true
    return next ?? child
  })
  return changed ? { ...tree, children } : tree
}

export function loadedDirectoryPaths(tree: TreeNode | null): string[] {
  if (!tree) return []
  const paths: string[] = []
  const walk = (node: TreeNode) => {
    if (node.kind !== "dir") return
    if (node.loaded) paths.push(node.path)
    for (const child of node.children) walk(child)
  }
  walk(tree)
  return paths
}

export function ancestorDirectories(root: string, target: string): string[] {
  if (target === root || !pathIsWithin(target, root)) return []
  const ancestors: string[] = []
  let cursor = parent(target)
  while (cursor && cursor !== root && pathIsWithin(cursor, root)) {
    ancestors.unshift(cursor)
    cursor = parent(cursor)
  }
  return cursor === root ? ancestors : []
}
