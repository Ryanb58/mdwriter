import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { basename, parent, joinPath } from "../../lib/paths"
import { noteSelfWrite } from "../watcher/useExternalChanges"
import { refreshDirectories } from "../tree/treeLoader"
import { beginOpenDocPathMutation } from "../../lib/writeDoc"
import { remapOpenDocumentPath } from "../../lib/openDocumentPaths"
import { errorText } from "../../lib/toast"

export class RenameOpenDocError extends Error {
  constructor(public reason: "no-doc" | "invalid-name" | "unchanged" | "ipc-failed", message: string, public cause?: unknown) {
    super(message)
  }
}

/**
 * Rename the currently open file. Used by the editor breadcrumb.
 *
 * The path-mutation guard flushes existing bytes and pauses later edits until
 * the successful rename has remapped their queued destination.
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

  const guard = await beginOpenDocPathMutation([oldPath])
  try {
    noteSelfWrite(oldPath)
    noteSelfWrite(newPath)
    try {
      await ipc.renamePath(oldPath, newPath)
    } catch (e) {
      throw new RenameOpenDocError("ipc-failed", `rename failed: ${errorText(e)}`, e)
    }

    // Remap queued coordinator bytes and every live store reference before a
    // refresh can fail. Never force dirty=false: edits made during IPC still
    // need to be written at the destination after release.
    guard.remap(oldPath, newPath)
    remapOpenDocumentPath(oldPath, newPath)

    await refreshDirectories([...new Set([parent(oldPath), parent(newPath)])])
  } finally {
    guard.release()
  }
}
