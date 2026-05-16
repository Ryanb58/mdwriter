import { ipc } from "../../lib/ipc"
import { useStore, treeOptionsFromSettings } from "../../lib/store"
import { joinPath, parent, basename } from "../../lib/paths"
import { pruneSubpaths, isUnderAny } from "./pruneSubpaths"

export async function refreshTree() {
  const root = useStore.getState().rootPath
  if (!root) return
  const opts = treeOptionsFromSettings(useStore.getState().settings)
  const tree = await ipc.listTree(root, opts)
  useStore.setState({ tree })
}

async function trashImpl(paths: readonly string[]) {
  const targets = pruneSubpaths(paths)
  if (targets.length === 0) return
  for (const p of targets) {
    try { await ipc.trashPath(p) } catch (e) { console.error(e) }
  }
  await refreshTree()
  const s = useStore.getState()
  const patch: Record<string, unknown> = {}

  if (s.openDoc && isUnderAny(s.openDoc.path, targets)) {
    patch.openDoc = null
  }

  let selectionChanged = false
  const nextPaths = new Set<string>()
  for (const cur of s.selectedPaths) {
    if (isUnderAny(cur, targets)) selectionChanged = true
    else nextPaths.add(cur)
  }
  if (selectionChanged) patch.selectedPaths = nextPaths

  if (s.selectedPath && isUnderAny(s.selectedPath, targets)) {
    patch.selectedPath = null
  }

  if (Object.keys(patch).length > 0) useStore.setState(patch)
}

export async function createNewFile(parentDir: string) {
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
  useStore.getState().toggleFolderExpanded(parentDir, true)
  useStore.getState().setSelected(candidate)
}

export function useTreeActions() {
  return {
    newFile: createNewFile,
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
      useStore.getState().toggleFolderExpanded(parentDir, true)
      useStore.getState().setSelected(candidate)
      useStore.getState().setRenamingPath(candidate)
    },
    async rename(from: string, newBasename: string) {
      const oldName = basename(from)
      const dot = oldName.lastIndexOf(".")
      const oldExt = dot > 0 ? oldName.slice(dot) : ""
      const normalized = newBasename.includes(".") || !oldExt ? newBasename : newBasename + oldExt
      const to = joinPath(parent(from), normalized)
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
      await trashImpl([path])
    },
    async trashMany(paths: readonly string[]) {
      await trashImpl(paths)
    },
  }
}
