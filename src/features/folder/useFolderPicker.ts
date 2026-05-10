import { open } from "@tauri-apps/plugin-dialog"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"

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
  await ipc.stopWatcher().catch(() => {})
  const tree = await ipc.listTree(path)
  await ipc.startWatcher(path)
  await ipc.pushRecentFolder(path)
  const recent = await ipc.getRecentFolders()
  deps.setRoot(path)
  deps.setTree(tree)
  deps.setRecent(recent)
}
