import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { basename, parent, joinPath } from "../../lib/paths"
import { noteSelfWrite } from "../watcher/useExternalChanges"
import { refreshTree } from "../tree/useTreeActions"
import { cancelPendingDocSave } from "./useAutoSave"

export class RenameOpenDocError extends Error {
  constructor(public reason: "no-doc" | "invalid-name" | "unchanged" | "ipc-failed", message: string, public cause?: unknown) {
    super(message)
  }
}

/**
 * Rename the currently open file. Used by the editor breadcrumb.
 *
 * If the doc is dirty, the current contents are written to the old path
 * before the rename so the renamed file reflects what the user sees.
 * `cancelPendingDocSave()` drops the debounced autosave so its cleanup
 * flush (fired by the open-doc path change) can't recreate the old file.
 */
export async function renameOpenDoc(rawName: string): Promise<void> {
  const s = useStore.getState()
  const doc = s.openDoc
  if (!doc) throw new RenameOpenDocError("no-doc", "no open document")

  const oldPath = doc.path
  const oldName = basename(oldPath)
  const trimmed = rawName.trim()
  if (!trimmed) throw new RenameOpenDocError("invalid-name", "name is empty")
  if (/[\\/]/.test(trimmed)) throw new RenameOpenDocError("invalid-name", "name cannot contain path separators")

  // Preserve the original extension if the user dropped it.
  const dotIdx = oldName.lastIndexOf(".")
  const oldExt = dotIdx > 0 ? oldName.slice(dotIdx) : ""
  const normalized = trimmed.includes(".") || !oldExt ? trimmed : trimmed + oldExt

  if (normalized === oldName) throw new RenameOpenDocError("unchanged", "name is unchanged")

  const newPath = joinPath(parent(oldPath), normalized)

  if (doc.dirty) {
    noteSelfWrite(oldPath)
    await ipc.writeFile(oldPath, { frontmatter: doc.frontmatter, body: doc.rawMarkdown })
  }
  cancelPendingDocSave()

  noteSelfWrite(oldPath)
  noteSelfWrite(newPath)
  try {
    await ipc.renamePath(oldPath, newPath)
  } catch (e) {
    throw new RenameOpenDocError("ipc-failed", `rename failed: ${e instanceof Error ? e.message : String(e)}`, e)
  }

  useStore.setState((cur) => {
    const nextPaths = new Set(cur.selectedPaths)
    if (nextPaths.has(oldPath)) {
      nextPaths.delete(oldPath)
      nextPaths.add(newPath)
    }
    return {
      selectedPath: cur.selectedPath === oldPath ? newPath : cur.selectedPath,
      selectedPaths: nextPaths,
      openDoc: cur.openDoc && cur.openDoc.path === oldPath
        ? { ...cur.openDoc, path: newPath, dirty: false, savedAt: Date.now() }
        : cur.openDoc,
    }
  })

  await refreshTree()
}
