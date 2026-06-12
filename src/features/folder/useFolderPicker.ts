import { open } from "@tauri-apps/plugin-dialog"
import { ipc } from "../../lib/ipc"
import { useStore, treeOptionsFromSettings } from "../../lib/store"
import { findNode } from "../tree/findNode"

export function useFolderPicker() {
  const setRoot = useStore((s) => s.setRoot)
  const setTree = useStore((s) => s.setTree)
  const setRecent = useStore((s) => s.setRecent)

  return async function pickFolder() {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || typeof selected !== "string") return
    await openFolder(selected, { setRoot, setTree, setRecent })
  }
}

export async function openFolder(
  path: string,
  deps: {
    setRoot: (p: string | null) => void
    setTree: (t: import("../../lib/ipc").TreeNode) => void
    setRecent: (l: string[]) => void
  },
) {
  // Switching vaults: drop any open file so the editor doesn't carry stale
  // state from the previous vault. useAutoSave's cleanup flushes pending
  // writes when openDoc.path changes, so unsaved edits aren't lost.
  useStore.setState({ selectedPath: null, selectedPaths: new Set(), expandedFolders: new Set(), openDoc: null })

  await ipc.stopWatcher().catch(() => {})
  const opts = treeOptionsFromSettings(useStore.getState().settings)
  // The watcher doesn't depend on the tree listing — start it in parallel.
  // listTree is also what establishes the vault scope on the Rust side, so
  // rootPath must only be set once it has succeeded (hooks keyed on
  // rootPath — chat hydration, autosave — immediately issue vault-scoped
  // commands).
  const [tree] = await Promise.all([
    ipc.listTree(path, opts),
    ipc.startWatcher(path),
  ])
  deps.setRoot(path)
  deps.setTree(tree)

  // Drop the user back into the note they were writing in this vault.
  restoreLastFile(path)

  // Bookkeeping that shouldn't block the vault becoming interactive.
  ipc.pushRecentFolder(path)
    .then(() => ipc.getRecentFolders())
    .then(deps.setRecent)
    .catch(() => {})
  // Best-effort: seed AGENTS.md if missing so the AI agent has vault
  // conventions on hand. Don't block vault open if this fails.
  ipc.ensureVaultAgentsMd(path).catch(() => {})
}

/**
 * Re-select the last file the user had open in this vault (if it still
 * exists) and expand its ancestor folders so the selection is visible.
 * Selection drives useOpenFile, which loads the doc from disk.
 */
function restoreLastFile(vaultPath: string) {
  const s = useStore.getState()
  const saved = s.recentFilesByVault[vaultPath]?.[0]
  if (!saved || !findNode(s.tree, saved)) return
  const expanded = new Set(s.expandedFolders)
  let dir = saved.slice(0, saved.lastIndexOf("/"))
  while (dir.length > vaultPath.length && dir.startsWith(vaultPath)) {
    expanded.add(dir)
    dir = dir.slice(0, dir.lastIndexOf("/"))
  }
  useStore.setState({ expandedFolders: expanded })
  s.setSelected(saved)
}
