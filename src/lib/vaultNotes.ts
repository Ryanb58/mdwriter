import { useEffect, useMemo, useState } from "react"
import { ipc, type TreeNode } from "./ipc"
import { useStore, treeOptionsFromSettings } from "./store"
import { isMarkdown } from "./paths"
import { errorText } from "./toast"

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

/** Markdown notes that are already present in the partially loaded sidebar. */
export function useLoadedVaultNotes(): VaultNote[] {
  const tree = useStore((s) => s.tree)
  const rootPath = useStore((s) => s.rootPath)
  return useMemo(() => flattenNotes(tree, rootPath), [tree, rootPath])
}

/** Compatibility alias for consumers migrated in the next implementation step. */
export const useVaultNotes = useLoadedVaultNotes

/** Enumerate the current vault once, without retaining the result globally. */
export function fetchVaultNotes(root: string): Promise<VaultNote[]> {
  const options = treeOptionsFromSettings(useStore.getState().settings)
  return ipc.listMarkdownNotes(root, options)
}

export type OnDemandVaultNotes = {
  notes: VaultNote[]
  status: "idle" | "loading" | "ready" | "error"
  error: string | null
}

const IDLE_NOTES: OnDemandVaultNotes = { notes: [], status: "idle", error: null }

/**
 * Owns a complete note list for one mounted UI surface. Closing that surface
 * unmounts the hook and releases the list; reopening performs a fresh walk.
 */
export function useOnDemandVaultNotes(enabled: boolean): OnDemandVaultNotes {
  const root = useStore((state) => state.rootPath)
  const [result, setResult] = useState<OnDemandVaultNotes>(IDLE_NOTES)

  useEffect(() => {
    if (!enabled || !root) {
      setResult(IDLE_NOTES)
      return
    }

    let cancelled = false
    setResult({ notes: [], status: "loading", error: null })
    void fetchVaultNotes(root).then(
      (notes) => {
        if (cancelled || useStore.getState().rootPath !== root) return
        setResult({ notes, status: "ready", error: null })
      },
      (error) => {
        if (cancelled || useStore.getState().rootPath !== root) return
        setResult({ notes: [], status: "error", error: errorText(error) })
      },
    )

    return () => {
      cancelled = true
    }
  }, [enabled, root])

  return result
}
