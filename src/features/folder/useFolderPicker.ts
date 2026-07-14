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
  const opts = treeOptionsFromSettings(useStore.getState().settings)

  try {
    if (oldRoot) {
      await ipc.stopWatcher()
      oldWatcherStopped = true
    }

    let tree: Awaited<ReturnType<typeof ipc.listTree>>
    while (true) {
      // `stopWatcher` clears Rust's active-vault scope, while `startWatcher`
      // deliberately does not restore it. Re-establish the old scope before
      // the final old-note flush, then make the new list the last authority.
      const currentDoc = useStore.getState().openDoc
      if (oldRoot && currentDoc && pathIsWithin(currentDoc.path, oldRoot)) {
        await ipc.listTree(oldRoot, opts)
        await guard.flush(currentDoc.path)
      }

      tree = await ipc.listTree(path, opts)
      await ipc.startWatcher(path)
      newWatcherStarted = true

      // The old editor remains usable while the async setup runs. If it was
      // edited after the final flush, tear down the provisional new watcher
      // and repeat the scope/flush/switch cycle. Once this check is clean, the
      // store commit below is synchronous, so no later old-path edit can land.
      const latestDoc = useStore.getState().openDoc
      const hasLateOldEdit = Boolean(
        latestDoc?.dirty &&
        oldRoot &&
        pathIsWithin(latestDoc.path, oldRoot),
      )
      if (!hasLateOldEdit) break

      await ipc.stopWatcher()
      newWatcherStarted = false
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
    // Once the old watcher has been stopped, any setup/save failure restores
    // both Rust's filesystem scope (listTree) and the watcher before the guard
    // releases and old-vault editing resumes.
    if (!committed && oldWatcherStopped) {
      if (newWatcherStarted) {
        await ipc.stopWatcher().catch(() => {})
      }
      if (oldRoot) {
        await ipc.listTree(oldRoot, opts).catch((restoreError) => {
          console.error("failed to restore previous vault scope", restoreError)
        })
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
