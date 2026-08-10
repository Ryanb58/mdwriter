import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({
  createFile: vi.fn(),
  createDir: vi.fn(),
  renamePath: vi.fn(),
  trashPath: vi.fn(),
  refreshDirectories: vi.fn(),
  reloadLoadedDirectories: vi.fn(),
  release: vi.fn(),
}))

vi.mock("../../../lib/ipc", () => ({
  ipc: {
    createFile: harness.createFile,
    createDir: harness.createDir,
    renamePath: harness.renamePath,
    trashPath: harness.trashPath,
  },
}))

vi.mock("../treeLoader", () => ({
  refreshDirectories: harness.refreshDirectories,
  reloadLoadedDirectories: harness.reloadLoadedDirectories,
}))

vi.mock("../../../lib/writeDoc", () => ({
  beginOpenDocPathMutation: vi.fn(async () => ({
    remap: vi.fn(),
    discard: vi.fn(),
    release: harness.release,
  })),
}))

vi.mock("../../watcher/useExternalChanges", () => ({ noteSelfWrite: vi.fn() }))

import { useStore } from "../../../lib/store"
import { createNewFile, refreshTree, useTreeActions } from "../useTreeActions"

describe("targeted sidebar refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.createFile.mockResolvedValue(undefined)
    harness.createDir.mockResolvedValue(undefined)
    harness.renamePath.mockResolvedValue(undefined)
    harness.trashPath.mockResolvedValue(undefined)
    harness.refreshDirectories.mockResolvedValue(undefined)
    harness.reloadLoadedDirectories.mockResolvedValue(undefined)
    useStore.setState({
      rootPath: "/vault",
      tree: { kind: "dir", name: "vault", path: "/vault", loaded: true, children: [] },
      openDoc: null,
      selectedPath: null,
      selectedPaths: new Set(),
      pinnedPaths: [],
      expandedFolders: new Set(),
    })
  })

  it("refreshes only the parent after creating a note", async () => {
    await createNewFile("/vault/notes")

    expect(harness.refreshDirectories).toHaveBeenCalledWith(["/vault/notes"])
    expect(harness.reloadLoadedDirectories).not.toHaveBeenCalled()
  })

  it("refreshes the affected parent once after an inline rename", async () => {
    await useTreeActions().rename("/vault/inbox/a.md", "b.md")

    expect(harness.refreshDirectories).toHaveBeenCalledWith(["/vault/inbox"])
  })

  it("refreshes each surviving parent once after a trash batch", async () => {
    await useTreeActions().trashMany([
      "/vault/notes/a.md",
      "/vault/notes/b.md",
      "/vault/archive/c.md",
    ])

    expect(harness.refreshDirectories).toHaveBeenCalledWith([
      "/vault/notes",
      "/vault/archive",
    ])
  })

  it("uses a full loaded-branch reload only for compatibility refreshes", async () => {
    await refreshTree()

    expect(harness.reloadLoadedDirectories).toHaveBeenCalledTimes(1)
    expect(harness.refreshDirectories).not.toHaveBeenCalled()
  })
})
