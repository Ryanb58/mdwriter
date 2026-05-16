import { useMemo } from "react"
import type { TreeNode } from "./ipc"
import { useStore } from "./store"
import { isMarkdown } from "./paths"

export type VaultNote = {
  /** Display name without the `.md` extension. */
  name: string
  /** Absolute path on disk. */
  path: string
  /** Path relative to vault root (forward-slash separated). */
  rel: string
  /** Last-modified time (Unix seconds), if the filesystem reported it. */
  mtime?: number
}

/**
 * Flatten a tree to its markdown files. `rootPath` is used to compute the
 * `rel` (vault-relative) path. We hide the extension on `name` because every
 * note in the vault is markdown — showing `.md` everywhere is noise.
 */
export function flattenNotes(node: TreeNode | null, rootPath: string | null): VaultNote[] {
  if (!node) return []
  const out: VaultNote[] = []
  const walk = (n: TreeNode) => {
    if (n.kind === "file") {
      if (!isMarkdown(n.path)) return
      const rel = rootPath && n.path.startsWith(rootPath)
        ? n.path.slice(rootPath.length).replace(/^[\\/]+/, "").replace(/\\/g, "/")
        : n.path
      out.push({
        name: n.name.replace(/\.(md|markdown)$/i, ""),
        path: n.path,
        rel,
        mtime: n.mtime,
      })
    } else {
      for (const c of n.children) walk(c)
    }
  }
  walk(node)
  return out
}

/** React hook that returns the current vault's markdown notes. */
export function useVaultNotes(): VaultNote[] {
  const tree = useStore((s) => s.tree)
  const rootPath = useStore((s) => s.rootPath)
  return useMemo(() => flattenNotes(tree, rootPath), [tree, rootPath])
}
