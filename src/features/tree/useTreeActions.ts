import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { joinPath, parent, basename } from "../../lib/paths"
import { beginOpenDocPathMutation } from "../../lib/writeDoc"
import {
  remapOpenDocumentPath,
  removeOpenDocumentPaths,
} from "../../lib/openDocumentPaths"
import { noteSelfWrite } from "../watcher/useExternalChanges"
import { pruneSubpaths } from "./pruneSubpaths"
import { refreshDirectories, reloadLoadedDirectories } from "./treeLoader"

export async function refreshTree() {
  await reloadLoadedDirectories()
}

async function trashImpl(paths: readonly string[]) {
  const targets = pruneSubpaths(paths)
  if (targets.length === 0) return
  const guard = await beginOpenDocPathMutation(targets)
  const successful: string[] = []
  try {
    for (const path of targets) {
      try {
        noteSelfWrite(path)
        await ipc.trashPath(path)
        successful.push(path)
      } catch (error) {
        console.error(error)
      }
    }

    // State follows only filesystem operations that actually succeeded. Do
    // this before refresh so a transient listing failure cannot resurrect a
    // deleted editor path or leave its queued bytes behind.
    guard.discard(successful)
    removeOpenDocumentPaths(successful)
    await refreshDirectories([...new Set(successful.map(parent))])
  } finally {
    guard.release()
  }
}

// Tauri command errors arrive as `{ kind, message }`. The Rust create_*
// commands surface filename collisions as `already exists: <path>`; only
// that case is safe to retry — other errors (permissions, missing parent,
// disk full) must propagate so the caller sees the real failure.
function isAlreadyExistsError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false
  const msg = (e as { message?: unknown }).message
  return typeof msg === "string" && msg.startsWith("already exists:")
}

export async function createNewFile(parentDir: string) {
  let n = 1
  let candidate = joinPath(parentDir, "untitled.md")
  while (true) {
    try {
      await ipc.createFile(candidate)
      break
    } catch (e) {
      if (!isAlreadyExistsError(e)) throw e
      n += 1
      candidate = joinPath(parentDir, `untitled ${n}.md`)
      if (n > 50) throw new Error("Too many untitled files")
    }
  }
  await refreshDirectories([parentDir])
  useStore.getState().toggleFolderExpanded(parentDir, true)
  // Flag this path so the editor that opens it lands the cursor at end
  // of the seeded `# ` heading. Must be set before setSelected so the
  // editor mount sees it on the first render.
  useStore.getState().setPendingCursorAtEnd(candidate)
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
        } catch (e) {
          if (!isAlreadyExistsError(e)) throw e
          n += 1
          candidate = joinPath(parentDir, `untitled folder ${n}`)
          if (n > 50) throw new Error("Too many untitled folders")
        }
      }
      await refreshDirectories([parentDir])
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
      const guard = await beginOpenDocPathMutation([from])
      try {
        noteSelfWrite(from)
        noteSelfWrite(to)
        await ipc.renamePath(from, to)
        guard.remap(from, to)
        remapOpenDocumentPath(from, to)
        await refreshDirectories([...new Set([parent(from), parent(to)])])
      } finally {
        guard.release()
      }
    },
    async trash(path: string) {
      await trashImpl([path])
    },
    async trashMany(paths: readonly string[]) {
      await trashImpl(paths)
    },
  }
}
