import { open } from "@tauri-apps/plugin-dialog"
import { ipc } from "../../lib/ipc"
import { useStore, treeOptionsFromSettings } from "../../lib/store"
import { findNode } from "../tree/findNode"
import { beginOpenDocPathMutation } from "../../lib/writeDoc"
import { pathIsWithin } from "../../lib/openDocumentPaths"

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
  const before = useStore.getState()
  const oldRoot = before.rootPath
  const oldRoots: string[] = []
  if (oldRoot) oldRoots.push(oldRoot)
  else if (before.openDoc) oldRoots.push(before.openDoc.path)
  const guard = await beginOpenDocPathMutation(oldRoots)
  let oldWatcherStopped = false
  let newWatcherStarted = false
  let committed = false

  try {
    const opts = treeOptionsFromSettings(useStore.getState().settings)

    // Read the new vault while the old watcher and all old-vault UI state are
    // still intact. A listing failure is therefore a true no-op.
    const tree = await ipc.listTree(path, opts)

    if (oldRoot) {
      await ipc.stopWatcher()
      oldWatcherStopped = true
    }
    await ipc.startWatcher(path)
    newWatcherStarted = true

    // The user can keep typing while the new vault is prepared. Flush the
    // latest old-vault document one final time while the guard remains paused
    // and immediately before clearing it from the store.
    const currentDoc = useStore.getState().openDoc
    if (
      currentDoc &&
      (!oldRoot || pathIsWithin(currentDoc.path, oldRoot))
    ) {
      await guard.flush(currentDoc.path)
    }

    guard.discard(oldRoots)
    useStore.setState({
      rootPath: path,
      tree,
      selectedPath: null,
      selectedPaths: new Set(),
      expandedFolders: new Set(),
      openDoc: null,
      loadError: null,
      blockModeOverrides: {},
      pendingScroll: null,
      blockTextIndex: null,
      pendingCursorAtEnd: null,
      headingCommittedPath: null,
      editorSelection: null,
      renamingPath: null,
    })
    committed = true

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
  } catch (error) {
    // Once the old watcher has been stopped, any setup/save failure rolls the
    // watcher back before the guard releases and old-vault editing resumes.
    if (!committed && (oldWatcherStopped || newWatcherStarted)) {
      if (newWatcherStarted) {
        await ipc.stopWatcher().catch(() => {})
      }
      if (oldRoot) {
        await ipc.startWatcher(oldRoot).catch((restoreError) => {
          console.error("failed to restore previous vault watcher", restoreError)
        })
      }
    }
    throw error
  } finally {
    guard.release()
  }
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
