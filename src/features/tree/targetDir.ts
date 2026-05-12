import type { TreeNode } from "../../lib/ipc"
import { parent } from "../../lib/paths"
import { findNode } from "./findNode"

/**
 * Pick the parent directory for a new file or folder, VSCode-style:
 *   - Selected folder → that folder
 *   - Selected file → the file's parent folder
 *   - Nothing selected, or selection no longer in tree → vault root
 *
 * Returns null only when no vault is open.
 */
export function targetParentDir(
  tree: TreeNode | null,
  selectedPath: string | null,
  rootPath: string | null,
): string | null {
  if (!rootPath) return null
  if (!selectedPath) return rootPath
  const node = findNode(tree, selectedPath)
  if (!node) return rootPath
  if (node.kind === "dir") return node.path
  return parent(node.path) || rootPath
}
