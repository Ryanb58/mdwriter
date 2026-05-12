import type { TreeNode } from "../../lib/ipc"

/** Walk the tree and return the node with the given path, or null. */
export function findNode(tree: TreeNode | null, path: string): TreeNode | null {
  if (!tree) return null
  if (tree.path === path) return tree
  if (tree.kind === "dir") {
    for (const c of tree.children) {
      const found = findNode(c, path)
      if (found) return found
    }
  }
  return null
}
