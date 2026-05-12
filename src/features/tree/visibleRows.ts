import type { TreeNode } from "../../lib/ipc"

/**
 * Flatten the tree into an in-order list of *visible* rows, given which
 * folders are expanded. The root node itself is not produced — only its
 * descendants — matching what TreePane renders.
 *
 * Used for shift-click range selection, where we need to enumerate rows
 * in the order the user sees them.
 */
export function visibleRows(
  tree: TreeNode | null,
  expanded: Set<string>,
): TreeNode[] {
  if (!tree || tree.kind !== "dir") return []
  const out: TreeNode[] = []
  const walk = (node: TreeNode) => {
    if (node.kind === "dir") {
      out.push(node)
      if (expanded.has(node.path)) {
        for (const child of node.children) walk(child)
      }
    } else {
      out.push(node)
    }
  }
  for (const child of tree.children) walk(child)
  return out
}

/**
 * Compute the inclusive range of visible rows between two paths. If
 * either anchor isn't found in the visible list, returns an empty array
 * (caller should fall back to single-select on the clicked row).
 */
export function rangeBetween(
  rows: TreeNode[],
  fromPath: string,
  toPath: string,
): TreeNode[] {
  const a = rows.findIndex((r) => r.path === fromPath)
  const b = rows.findIndex((r) => r.path === toPath)
  if (a < 0 || b < 0) return []
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return rows.slice(lo, hi + 1)
}
