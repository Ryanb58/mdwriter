import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TreeNode } from "../../../lib/ipc"

const harness = vi.hoisted(() => ({
  listDirectory: vi.fn(),
  listTree: vi.fn(),
}))

vi.mock("../../../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/ipc")>()
  return {
    ...actual,
    ipc: {
      ...actual.ipc,
      listDirectory: harness.listDirectory,
      listTree: harness.listTree,
    },
  }
})

import { useStore } from "../../../lib/store"
import { runVaultListingExclusive } from "../../../lib/vaultTransactions"
import { findNode } from "../findNode"
import {
  loadDirectory,
  refreshDirectories,
  reloadLoadedDirectories,
  revealPath,
} from "../treeLoader"

const file = (path: string): TreeNode => ({
  kind: "file",
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
})

const dir = (
  path: string,
  children: TreeNode[] = [],
  loaded = true,
): TreeNode => ({
  kind: "dir",
  name: path.slice(path.lastIndexOf("/") + 1) || path,
  path,
  children,
  loaded,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("treeLoader", () => {
  beforeEach(() => {
    harness.listDirectory.mockReset()
    harness.listTree.mockReset()
    useStore.setState({
      rootPath: "/vault",
      tree: dir("/vault", [dir("/vault/notes", [], false)]),
      expandedFolders: new Set(),
      loadingFolders: new Set(),
      folderLoadErrors: {},
    })
  })

  it("deduplicates concurrent requests for the same directory", async () => {
    const pending = deferred<TreeNode>()
    harness.listDirectory.mockReturnValue(pending.promise)

    const first = loadDirectory("/vault/notes")
    const second = loadDirectory("/vault/notes")

    expect(harness.listDirectory).toHaveBeenCalledTimes(1)
    expect(useStore.getState().loadingFolders).toContain("/vault/notes")

    pending.resolve(dir("/vault/notes", [file("/vault/notes/a.md")]))
    await expect(Promise.all([first, second])).resolves.toEqual(["loaded", "loaded"])
    expect(useStore.getState().loadingFolders).not.toContain("/vault/notes")
  })

  it("ignores a directory response after the active vault changes", async () => {
    const pending = deferred<TreeNode>()
    harness.listDirectory.mockReturnValue(pending.promise)
    const loading = loadDirectory("/vault/notes")

    const otherTree = dir("/other")
    useStore.setState({ rootPath: "/other", tree: otherTree })
    pending.resolve(dir("/vault/notes", [file("/vault/notes/a.md")]))

    await expect(loading).resolves.toBe("stale")
    expect(useStore.getState().tree).toBe(otherTree)
  })

  it("records an error only for the directory that failed", async () => {
    useStore.setState({ folderLoadErrors: { "/vault/other": "offline" } })
    harness.listDirectory.mockRejectedValue(new Error("permission denied"))

    await expect(loadDirectory("/vault/notes")).resolves.toBe("missing")

    expect(useStore.getState().folderLoadErrors).toEqual({
      "/vault/other": "offline",
      "/vault/notes": "permission denied",
    })
  })

  it("loads only missing ancestors and reveals a nested file", async () => {
    harness.listDirectory.mockImplementation(async (path: string) => {
      if (path === "/vault/notes") {
        return dir(path, [dir("/vault/notes/deep", [], false)])
      }
      if (path === "/vault/notes/deep") {
        return dir(path, [file("/vault/notes/deep/a.md")])
      }
      throw new Error(`unexpected path: ${path}`)
    })

    await expect(revealPath("/vault/notes/deep/a.md")).resolves.toBe("found")

    expect(harness.listDirectory.mock.calls.map(([path]) => path)).toEqual([
      "/vault/notes",
      "/vault/notes/deep",
    ])
    expect(useStore.getState().expandedFolders).toEqual(
      new Set(["/vault/notes", "/vault/notes/deep"]),
    )
  })

  it("reports a missing final file after loading its parent", async () => {
    harness.listDirectory.mockResolvedValue(dir("/vault/notes", []))

    await expect(revealPath("/vault/notes/missing.md")).resolves.toBe("missing")
    expect(harness.listDirectory).toHaveBeenCalledTimes(1)
  })

  it("follows an in-flight first expansion with a fresh requested refresh", async () => {
    const initial = deferred<TreeNode>()
    harness.listDirectory
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(dir("/vault/notes", [file("/vault/notes/new.md")]))

    const expanding = loadDirectory("/vault/notes")
    const refreshing = refreshDirectories(["/vault/notes"])
    expect(harness.listDirectory).toHaveBeenCalledTimes(1)

    initial.resolve(dir("/vault/notes", [file("/vault/notes/old.md")]))
    await vi.waitFor(() => expect(harness.listDirectory).toHaveBeenCalledTimes(2))
    await Promise.all([expanding, refreshing])

    expect(findNode(useStore.getState().tree, "/vault/notes/new.md")?.kind).toBe("file")
    expect(findNode(useStore.getState().tree, "/vault/notes/old.md")).toBeNull()
  })

  it("waits for an active vault switch before choosing a root to reload", async () => {
    const gate = deferred<void>()
    const switching = runVaultListingExclusive(async () => {
      await gate.promise
      useStore.setState({ rootPath: "/other", tree: dir("/other") })
    })
    harness.listTree.mockImplementation(async (root: string) => dir(root))

    const reloading = reloadLoadedDirectories()
    await Promise.resolve()
    expect(harness.listTree).not.toHaveBeenCalled()

    gate.resolve()
    await switching
    await reloading

    expect(harness.listTree).toHaveBeenCalledWith("/other", expect.anything())
    expect(useStore.getState().rootPath).toBe("/other")
  })

  it("invalidates an old directory request when visibility settings reload", async () => {
    const oldRequest = deferred<TreeNode>()
    useStore.setState({
      tree: dir("/vault", [
        dir("/vault/notes", [file("/vault/notes/old.md")]),
      ]),
    })
    harness.listDirectory
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(dir("/vault/notes", [file("/vault/notes/new.md")]))
    harness.listTree.mockResolvedValue(
      dir("/vault", [dir("/vault/notes", [], false)]),
    )

    const staleRefresh = loadDirectory("/vault/notes")
    const settingsReload = reloadLoadedDirectories()
    await vi.waitFor(() => expect(harness.listTree).toHaveBeenCalledTimes(1))
    oldRequest.resolve(dir("/vault/notes", [file("/vault/notes/old.md")]))
    await Promise.all([staleRefresh, settingsReload])

    expect(harness.listDirectory).toHaveBeenCalledTimes(2)
    expect(findNode(useStore.getState().tree, "/vault/notes/new.md")?.kind).toBe("file")
    expect(findNode(useStore.getState().tree, "/vault/notes/old.md")).toBeNull()
  })
})
