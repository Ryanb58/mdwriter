import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({
  listTree: vi.fn(),
  startWatcher: vi.fn(),
  stopWatcher: vi.fn(),
  pushRecentFolder: vi.fn(),
  getRecentFolders: vi.fn(),
  ensureVaultAgentsMd: vi.fn(),
  begin: vi.fn(),
  flush: vi.fn(),
  remap: vi.fn(),
  discard: vi.fn(),
  release: vi.fn(),
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }))

vi.mock("../../../lib/ipc", () => ({
  ipc: {
    listTree: harness.listTree,
    startWatcher: harness.startWatcher,
    stopWatcher: harness.stopWatcher,
    pushRecentFolder: harness.pushRecentFolder,
    getRecentFolders: harness.getRecentFolders,
    ensureVaultAgentsMd: harness.ensureVaultAgentsMd,
  },
}))

vi.mock("../../../lib/writeDoc", () => ({
  beginOpenDocPathMutation: harness.begin,
}))

import { useStore } from "../../../lib/store"
import { openFolder } from "../useFolderPicker"

const oldTree = {
  kind: "dir" as const,
  name: "old",
  path: "/old",
  children: [{ kind: "file" as const, name: "draft.md", path: "/old/draft.md" }],
}

const newTree = {
  kind: "dir" as const,
  name: "new",
  path: "/new",
  children: [
    {
      kind: "dir" as const,
      name: "notes",
      path: "/new/notes",
      children: [{ kind: "file" as const, name: "last.md", path: "/new/notes/last.md" }],
    },
  ],
}

function deps() {
  const state = useStore.getState()
  return {
    setRoot: state.setRoot,
    setTree: state.setTree,
    setRecent: state.setRecent,
  }
}

function expectOldVaultIntact() {
  const state = useStore.getState()
  expect(state.rootPath).toBe("/old")
  expect(state.tree).toBe(oldTree)
  expect(state.openDoc?.path).toBe("/old/draft.md")
  expect(state.selectedPath).toBe("/old/draft.md")
}

describe("openFolder transaction", () => {
  beforeEach(() => {
    harness.listTree.mockReset()
    harness.listTree.mockResolvedValue(newTree)
    harness.startWatcher.mockReset()
    harness.startWatcher.mockResolvedValue(undefined)
    harness.stopWatcher.mockReset()
    harness.stopWatcher.mockResolvedValue(undefined)
    harness.pushRecentFolder.mockReset()
    harness.pushRecentFolder.mockResolvedValue(undefined)
    harness.getRecentFolders.mockReset()
    harness.getRecentFolders.mockResolvedValue(["/new", "/old"])
    harness.ensureVaultAgentsMd.mockReset()
    harness.ensureVaultAgentsMd.mockResolvedValue(undefined)
    harness.begin.mockReset()
    harness.flush.mockReset()
    harness.flush.mockResolvedValue(undefined)
    harness.remap.mockReset()
    harness.discard.mockReset()
    harness.release.mockReset()
    harness.begin.mockResolvedValue({
      flush: harness.flush,
      remap: harness.remap,
      discard: harness.discard,
      release: harness.release,
    })

    useStore.setState({
      rootPath: "/old",
      tree: oldTree,
      selectedPath: "/old/draft.md",
      selectedPaths: new Set(["/old/draft.md"]),
      expandedFolders: new Set(["/old"]),
      openDoc: null,
      loadError: null,
      blockModeOverrides: { "/old/draft.md": "fingerprint" },
      pendingScroll: null,
      blockTextIndex: null,
      pendingCursorAtEnd: null,
      headingCommittedPath: null,
      editorSelection: null,
      renamingPath: null,
      recentFilesByVault: {
        "/new": ["/new/notes/last.md"],
      },
    })
    useStore.getState().openAnalyzedDocument("/old/draft.md", "draft", "disk")
    useStore.setState({
      blockTextIndex: {
        path: "/old/draft.md",
        docKey: "/old/draft.md#1",
        blocks: [],
      },
    })
  })

  it("does nothing when the old-note guard cannot flush", async () => {
    harness.begin.mockRejectedValue(new Error("disk full"))

    await expect(openFolder("/new", deps())).rejects.toThrow("disk full")

    expectOldVaultIntact()
    expect(harness.listTree).not.toHaveBeenCalled()
    expect(harness.stopWatcher).not.toHaveBeenCalled()
    expect(harness.startWatcher).not.toHaveBeenCalled()
  })

  it("leaves the old watcher and store untouched when listing fails", async () => {
    harness.listTree.mockRejectedValue(new Error("not readable"))

    await expect(openFolder("/new", deps())).rejects.toThrow("not readable")

    expectOldVaultIntact()
    expect(harness.stopWatcher).not.toHaveBeenCalled()
    expect(harness.startWatcher).not.toHaveBeenCalled()
    expect(harness.release).toHaveBeenCalledTimes(1)
  })

  it("restores the old watcher when starting the new watcher fails", async () => {
    harness.startWatcher
      .mockRejectedValueOnce(new Error("watch failed"))
      .mockResolvedValueOnce(undefined)

    await expect(openFolder("/new", deps())).rejects.toThrow("watch failed")

    expectOldVaultIntact()
    expect(harness.stopWatcher).toHaveBeenCalledTimes(1)
    expect(harness.startWatcher.mock.calls).toEqual([["/new"], ["/old"]])
    expect(harness.release).toHaveBeenCalledTimes(1)
  })

  it("rolls the watcher back when a final edit cannot be saved", async () => {
    harness.flush.mockRejectedValue(new Error("final save failed"))

    await expect(openFolder("/new", deps())).rejects.toThrow("final save failed")

    expectOldVaultIntact()
    expect(harness.stopWatcher).toHaveBeenCalledTimes(2)
    expect(harness.startWatcher.mock.calls).toEqual([["/new"], ["/old"]])
    expect(harness.discard).not.toHaveBeenCalled()
    expect(harness.release).toHaveBeenCalledTimes(1)
  })

  it("flushes edits made during setup, commits once, then restores the recent file", async () => {
    const listing = deferred<typeof newTree>()
    harness.listTree.mockReturnValue(listing.promise)

    const switching = openFolder("/new", deps())
    await vi.waitFor(() => expect(harness.listTree).toHaveBeenCalledWith("/new", expect.anything()))
    useStore.getState().editOpenDoc("typed during setup")
    listing.resolve(newTree)
    await switching

    expect(harness.begin).toHaveBeenCalledWith(["/old"])
    expect(harness.flush).toHaveBeenCalledWith("/old/draft.md")
    expect(harness.discard).toHaveBeenCalledWith(["/old"])
    expect(harness.release).toHaveBeenCalledTimes(1)
    const state = useStore.getState()
    expect(state.rootPath).toBe("/new")
    expect(state.tree).toBe(newTree)
    expect(state.openDoc).toBeNull()
    expect(state.selectedPath).toBe("/new/notes/last.md")
    expect(state.selectedPaths).toEqual(new Set(["/new/notes/last.md"]))
    expect(state.expandedFolders.has("/new/notes")).toBe(true)
    expect(state.blockModeOverrides).toEqual({})
    expect(state.blockTextIndex).toBeNull()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}
