import { open } from "@tauri-apps/plugin-dialog"
import { ipc } from "../../lib/ipc"
import { useStore, treeOptionsFromSettings } from "../../lib/store"

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
    setRoot: (p: string) => void
    setTree: (t: import("../../lib/ipc").TreeNode) => void
    setRecent: (l: string[]) => void
  },
) {
  // Switching vaults: drop any open file so the editor doesn't carry stale
  // state from the previous vault. useAutoSave's cleanup flushes pending
  // writes when openDoc.path changes, so unsaved edits aren't lost.
  useStore.setState({ selectedPath: null, openDoc: null })

  await ipc.stopWatcher().catch(() => {})
  const opts = treeOptionsFromSettings(useStore.getState().settings)
  const tree = await ipc.listTree(path, opts)
  await ipc.startWatcher(path)
  await ipc.pushRecentFolder(path)
  const recent = await ipc.getRecentFolders()
  // Best-effort: seed AGENTS.md if missing so the AI agent has vault
  // conventions on hand. Don't block vault open if this fails.
  ipc.ensureVaultAgentsMd(path).catch(() => {})
  deps.setRoot(path)
  deps.setTree(tree)
  deps.setRecent(recent)
}
