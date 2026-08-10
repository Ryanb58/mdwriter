import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({
  renamePath: vi.fn(),
  trashPath: vi.fn(),
  listTree: vi.fn(),
  begin: vi.fn(),
  remap: vi.fn(),
  discard: vi.fn(),
  release: vi.fn(),
}))

vi.mock("../../../lib/ipc", () => ({
  ipc: {
    renamePath: harness.renamePath,
    trashPath: harness.trashPath,
    listTree: harness.listTree,
  },
}))

vi.mock("../../../lib/writeDoc", () => ({
  beginOpenDocPathMutation: harness.begin,
}))

vi.mock("../../watcher/useExternalChanges", () => ({
  noteSelfWrite: vi.fn(),
}))

vi.mock("../treeLoader", () => ({
  refreshDirectories: vi.fn(async () => {}),
  reloadLoadedDirectories: vi.fn(async () => {}),
}))

import { useStore } from "../../../lib/store"
import { useTreeActions } from "../useTreeActions"

function open(path: string) {
  useStore.getState().openAnalyzedDocument(path, "# note", "disk")
  useStore.setState({
    rootPath: "/vault",
    selectedPath: path,
    selectedPaths: new Set([path]),
  })
}

describe("tree path-operation save guards", () => {
  beforeEach(() => {
    harness.renamePath.mockReset()
    harness.renamePath.mockResolvedValue(undefined)
    harness.trashPath.mockReset()
    harness.trashPath.mockResolvedValue(undefined)
    harness.listTree.mockReset()
    harness.listTree.mockResolvedValue({
      kind: "dir",
      name: "vault",
      path: "/vault",
      children: [],
    })
    harness.begin.mockReset()
    harness.remap.mockReset()
    harness.discard.mockReset()
    harness.release.mockReset()
    harness.begin.mockResolvedValue({
      remap: harness.remap,
      discard: harness.discard,
      release: harness.release,
    })
    useStore.setState({
      rootPath: "/vault",
      tree: null,
      openDoc: null,
      selectedPath: null,
      selectedPaths: new Set(),
      expandedFolders: new Set(),
      pinnedPaths: [],
      blockModeOverrides: {},
      pendingScroll: null,
      pendingCursorAtEnd: null,
      headingCommittedPath: null,
      editorSelection: null,
      loadError: null,
      renamingPath: null,
      recentFilesByVault: {},
    })
  })

  it("blocks an ancestor-folder rename until the open note guard is acquired", async () => {
    open("/vault/notes/a.md")
    const acquisition = deferred<{
      remap: typeof harness.remap
      discard: typeof harness.discard
      release: typeof harness.release
    }>()
    harness.begin.mockReturnValue(acquisition.promise)

    const renaming = useTreeActions().rename("/vault/notes", "archive")
    await Promise.resolve()
    expect(harness.begin).toHaveBeenCalledWith(["/vault/notes"])
    expect(harness.renamePath).not.toHaveBeenCalled()

    acquisition.resolve({
      remap: harness.remap,
      discard: harness.discard,
      release: harness.release,
    })
    await renaming
    expect(harness.renamePath).toHaveBeenCalledWith("/vault/notes", "/vault/archive")
    expect(useStore.getState().openDoc?.path).toBe("/vault/archive/a.md")
    expect(harness.remap).toHaveBeenCalledWith("/vault/notes", "/vault/archive")
    expect(harness.release).toHaveBeenCalledTimes(1)
  })

  it("performs no inline rename when the affected save guard fails", async () => {
    open("/vault/a.md")
    harness.begin.mockRejectedValue(new Error("save failed"))

    await expect(useTreeActions().rename("/vault/a.md", "b.md"))
      .rejects.toThrow("save failed")

    expect(harness.renamePath).not.toHaveBeenCalled()
    expect(useStore.getState().openDoc?.path).toBe("/vault/a.md")
  })

  it("performs no trash operation when the affected save guard fails", async () => {
    open("/vault/a.md")
    harness.begin.mockRejectedValue(new Error("save failed"))

    await expect(useTreeActions().trash("/vault/a.md")).rejects.toThrow("save failed")

    expect(harness.trashPath).not.toHaveBeenCalled()
    expect(useStore.getState().openDoc?.path).toBe("/vault/a.md")
  })

  it("clears only successful paths from a partially failed trash batch", async () => {
    open("/vault/keep.md")
    useStore.setState({
      selectedPath: "/vault/keep.md",
      selectedPaths: new Set(["/vault/gone.md", "/vault/keep.md"]),
      pinnedPaths: ["/vault/gone.md", "/vault/keep.md"],
      pendingScroll: {
        kind: "vault-reveal",
        path: "/vault/gone.md",
        line: 1,
        matchText: "gone",
        occurrence: 0,
      },
    })
    harness.trashPath
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("permission denied"))

    await useTreeActions().trashMany(["/vault/gone.md", "/vault/keep.md"])

    expect(harness.discard).toHaveBeenCalledWith(["/vault/gone.md"])
    expect(harness.discard).not.toHaveBeenCalledWith(["/vault/keep.md"])
    expect(useStore.getState().openDoc?.path).toBe("/vault/keep.md")
    expect([...useStore.getState().selectedPaths]).toEqual(["/vault/keep.md"])
    expect(useStore.getState().pinnedPaths).toEqual(["/vault/keep.md"])
    expect(useStore.getState().pendingScroll).toBeNull()
    expect(harness.release).toHaveBeenCalledTimes(1)
  })

  it("does not remove a sibling that merely shares the trashed prefix", async () => {
    open("/vault/notes-old/keep.md")

    await useTreeActions().trash("/vault/notes")

    expect(useStore.getState().openDoc?.path).toBe("/vault/notes-old/keep.md")
  })

  it("waits until the batch ends to discard edits made after an early trash", async () => {
    open("/vault/gone.md")
    const secondTrash = deferred<void>()
    harness.trashPath
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(secondTrash.promise)

    const trashing = useTreeActions().trashMany([
      "/vault/gone.md",
      "/vault/other.md",
    ])
    await vi.waitFor(() => expect(harness.trashPath).toHaveBeenCalledTimes(2))
    useStore.getState().editOpenDoc("typed after the first trash finished")
    expect(harness.discard).not.toHaveBeenCalled()

    secondTrash.resolve()
    await trashing

    expect(harness.discard).toHaveBeenCalledWith([
      "/vault/gone.md",
      "/vault/other.md",
    ])
    expect(useStore.getState().openDoc).toBeNull()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}
