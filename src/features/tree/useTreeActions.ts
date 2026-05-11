import { ipc } from "../../lib/ipc"
import { useStore, treeOptionsFromSettings } from "../../lib/store"
import { joinPath, parent } from "../../lib/paths"

export async function refreshTree() {
  const root = useStore.getState().rootPath
  if (!root) return
  const opts = treeOptionsFromSettings(useStore.getState().settings)
  const tree = await ipc.listTree(root, opts)
  useStore.setState({ tree })
}

export function useTreeActions() {
  return {
    async newFile(parentDir: string) {
      let n = 1
      let candidate = joinPath(parentDir, "untitled.md")
      while (true) {
        try {
          await ipc.createFile(candidate)
          break
        } catch {
          n += 1
          candidate = joinPath(parentDir, `untitled ${n}.md`)
          if (n > 50) throw new Error("Too many untitled files")
        }
      }
      await refreshTree()
      useStore.getState().setSelected(candidate)
    },
    async newFolder(parentDir: string) {
      let n = 1
      let candidate = joinPath(parentDir, "untitled folder")
      while (true) {
        try {
          await ipc.createDir(candidate)
          break
        } catch {
          n += 1
          candidate = joinPath(parentDir, `untitled folder ${n}`)
          if (n > 50) throw new Error("Too many untitled folders")
        }
      }
      await refreshTree()
    },
    async rename(from: string, newBasename: string) {
      const to = joinPath(parent(from), newBasename)
      await ipc.renamePath(from, to)
      await refreshTree()
      const s = useStore.getState()
      const patch: Record<string, unknown> = {}
      if (s.selectedPath === from) patch.selectedPath = to
      if (s.selectedPaths.has(from)) {
        const next = new Set(s.selectedPaths)
        next.delete(from)
        next.add(to)
        patch.selectedPaths = next
      }
      if (Object.keys(patch).length > 0) useStore.setState(patch)
    },
    async trash(path: string) {
      await ipc.trashPath(path)
      await refreshTree()
      const s = useStore.getState()
      const patch: Record<string, unknown> = {}
      if (s.selectedPath === path) {
        patch.selectedPath = null
        patch.openDoc = null
      }
      if (s.selectedPaths.has(path)) {
        const next = new Set(s.selectedPaths)
        next.delete(path)
        patch.selectedPaths = next
      }
      if (Object.keys(patch).length > 0) useStore.setState(patch)
    },
  }
}
