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
  loaded: true,
  children: [{ kind: "file" as const, name: "draft.md", path: "/old/draft.md" }],
}

const newTree = {
  kind: "dir" as const,
  name: "new",
  path: "/new",
  loaded: true,
  children: [
    {
      kind: "dir" as const,
      name: "notes",
      path: "/new/notes",
      loaded: true,
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
    harness.listTree.mockImplementation(async (listedPath: string) =>
      listedPath === "/old" ? oldTree : newTree)
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

  it("restores the old scope and watcher when the new listing fails", async () => {
    harness.listTree.mockImplementation((path: string) => path === "/old"
      ? Promise.resolve(oldTree)
      : Promise.reject(new Error("not readable")))

    await expect(openFolder("/new", deps())).rejects.toThrow("not readable")

    expectOldVaultIntact()
    expect(harness.stopWatcher).toHaveBeenCalledTimes(1)
    expect(harness.listTree.mock.calls.map(([path]) => path)).toEqual([
      "/old",
      "/new",
      "/old",
    ])
    expect(harness.startWatcher).toHaveBeenCalledWith("/old")
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
    expect(harness.stopWatcher).toHaveBeenCalledTimes(1)
    expect(harness.startWatcher.mock.calls).toEqual([["/old"]])
    expect(harness.listTree.mock.calls.map(([path]) => path)).toEqual([
      "/old",
      "/old",
    ])
    expect(harness.discard).not.toHaveBeenCalled()
    expect(harness.release).toHaveBeenCalledTimes(1)
  })

  it("flushes edits made during setup, commits once, then restores the recent file", async () => {
    const listing = deferred<typeof newTree>()
    let activeVault: string | null = "/old"
    let newListings = 0
    harness.listTree.mockImplementation((path: string) => {
      activeVault = path
      if (path === "/new" && newListings++ === 0) return listing.promise
      return Promise.resolve(path === "/old" ? oldTree : newTree)
    })
    harness.stopWatcher.mockImplementation(async () => {
      activeVault = null
    })
    harness.flush.mockImplementation(async () => {
      expect(activeVault).toBe("/old")
      useStore.getState().patchOpenDoc({ dirty: false, saveStatus: "clean" })
    })

    const switching = openFolder("/new", deps())
    await vi.waitFor(() => expect(harness.listTree).toHaveBeenCalledWith("/new", expect.anything()))
    useStore.getState().editOpenDoc("typed during setup")
    listing.resolve(newTree)
    await switching

    expect(harness.begin).toHaveBeenCalledWith(["/old"])
    expect(harness.flush).toHaveBeenCalledWith("/old/draft.md")
    expect(harness.listTree).toHaveBeenCalledWith("/old", expect.anything())
    expect(activeVault).toBe("/new")
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

  it("leaves the new vault as the backend filesystem scope after switching", async () => {
    let activeVault: string | null = "/old"
    const order: string[] = []
    harness.listTree.mockImplementation(async (path: string) => {
      order.push(`list:${path}`)
      activeVault = path
      return path === "/old" ? oldTree : newTree
    })
    harness.stopWatcher.mockImplementation(async () => {
      order.push("stop")
      activeVault = null
    })
    harness.startWatcher.mockImplementation(async (path: string) => {
      order.push(`start:${path}`)
      // Rust start_watcher deliberately does not establish active_vault.
    })

    await openFolder("/new", deps())

    expect(activeVault).toBe("/new")
    expect(order.at(-1)).toBe("start:/new")
    expect(order.indexOf("stop")).toBeLessThan(order.lastIndexOf("list:/new"))
  })

  it("serializes rapid folder switches and rolls back to the latest committed vault", async () => {
    const firstNewListing = deferred<typeof newTree>()
    let firstNewCall = true
    harness.listTree.mockImplementation((path: string) => {
      if (path === "/old") return Promise.resolve(oldTree)
      if (path === "/new") {
        if (firstNewCall) {
          firstNewCall = false
          return firstNewListing.promise
        }
        return Promise.resolve(newTree)
      }
      return Promise.reject(new Error("other vault unavailable"))
    })

    const firstSwitch = openFolder("/new", deps())
    await vi.waitFor(() => {
      expect(harness.listTree).toHaveBeenCalledWith("/new", expect.anything())
    })

    const secondSwitch = openFolder("/other", deps())
    await Promise.resolve()
    expect(harness.begin).toHaveBeenCalledTimes(1)

    firstNewListing.resolve(newTree)
    await firstSwitch
    await expect(secondSwitch).rejects.toThrow("other vault unavailable")

    expect(harness.begin.mock.calls.map(([roots]) => roots)).toEqual([
      ["/old"],
      ["/new"],
    ])
    expect(harness.listTree.mock.calls.map(([listedPath]) => listedPath)).toEqual([
      "/old",
      "/new",
      "/other",
      "/new",
    ])
    expect(harness.startWatcher.mock.calls.at(-1)).toEqual(["/new"])
    expect(useStore.getState().rootPath).toBe("/new")
    expect(useStore.getState().tree).toBe(newTree)
  })

  it("uses canonical tree roots and still flushes a legacy symlinked open note", async () => {
    const canonicalOldTree = {
      kind: "dir" as const,
      name: "old",
      path: "/real/old",
      loaded: true,
      children: [
        {
          kind: "file" as const,
          name: "draft.md",
          path: "/real/old/draft.md",
        },
      ],
    }
    const canonicalNewTree = {
      kind: "dir" as const,
      name: "new",
      path: "/real/new",
      loaded: true,
      children: [
        {
          kind: "file" as const,
          name: "note.md",
          path: "/real/new/note.md",
        },
      ],
    }
    useStore.getState().openAnalyzedDocument(
      "/real/old/draft.md",
      "dirty canonical note",
      "disk",
    )
    useStore.getState().editOpenDoc("edited through the symlinked vault")
    useStore.setState({
      rootPath: "/alias/old",
      tree: canonicalOldTree,
      selectedPath: "/real/old/draft.md",
      selectedPaths: new Set(["/real/old/draft.md"]),
    })
    harness.listTree.mockImplementation(async (listedPath: string) =>
      listedPath === "/alias/old" ? canonicalOldTree : canonicalNewTree)
    harness.flush.mockImplementation(async () => {
      useStore.getState().patchOpenDoc({ dirty: false, saveStatus: "clean" })
    })

    await openFolder("/alias/new", deps())

    expect(harness.begin).toHaveBeenCalledWith([
      "/alias/old",
      "/real/old",
    ])
    expect(harness.flush).toHaveBeenCalledWith("/real/old/draft.md")
    expect(harness.startWatcher).toHaveBeenCalledWith("/real/new")
    expect(useStore.getState().rootPath).toBe("/real/new")
    expect(useStore.getState().tree).toBe(canonicalNewTree)
    expect(harness.pushRecentFolder).toHaveBeenCalledWith("/alias/new")
  })

  it("restores a legacy symlinked watcher at its canonical root", async () => {
    const canonicalOldTree = {
      kind: "dir" as const,
      name: "old",
      path: "/real/old",
      loaded: true,
      children: [
        {
          kind: "file" as const,
          name: "draft.md",
          path: "/real/old/draft.md",
        },
      ],
    }
    useStore.getState().openAnalyzedDocument(
      "/real/old/draft.md",
      "retained note",
      "disk",
    )
    useStore.setState({ rootPath: "/alias/old", tree: canonicalOldTree })
    harness.listTree.mockImplementation((listedPath: string) =>
      listedPath === "/alias/old"
        ? Promise.resolve(canonicalOldTree)
        : Promise.reject(new Error("new vault unavailable")))

    await expect(openFolder("/alias/new", deps())).rejects.toThrow(
      "new vault unavailable",
    )

    expect(harness.startWatcher.mock.calls.at(-1)).toEqual(["/real/old"])
    expect(useStore.getState().rootPath).toBe("/alias/old")
    expect(useStore.getState().openDoc?.path).toBe("/real/old/draft.md")
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}
