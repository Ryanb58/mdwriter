import { describe, it, expect, beforeEach, vi } from "vitest"
import { useStore } from "../../../lib/store"
import { usePromptStore } from "../dndPrompts"

const saveHarness = vi.hoisted(() => ({
  begin: vi.fn(),
  remap: vi.fn(),
  discard: vi.fn(),
  release: vi.fn(),
}))

vi.mock("../../../lib/ipc", () => {
  // The mock has its own in-memory FS for rename_path so we can exercise
  // collision and remap logic without touching disk.
  const fsState: { existing: Set<string> } = { existing: new Set() }
  return {
    __fsState: fsState,
    ipc: {
      renamePath: vi.fn(async (from: string, to: string) => {
        if (fsState.existing.has(to)) {
          throw new Error(`destination exists: ${to}`)
        }
        fsState.existing.delete(from)
        fsState.existing.add(to)
      }),
      listTree: vi.fn(async () => ({ kind: "dir", name: "root", path: "/root", children: [] })),
    },
  }
})

vi.mock("../../watcher/useExternalChanges", () => ({
  noteSelfWrite: vi.fn(),
}))

vi.mock("../treeLoader", async () => ({
  refreshDirectories: vi.fn(async () => {}),
}))

vi.mock("../../../lib/writeDoc", () => ({
  beginOpenDocPathMutation: saveHarness.begin,
}))

import { moveItems } from "../moveExecutor"
import * as ipcMod from "../../../lib/ipc"
import { refreshDirectories } from "../treeLoader"

function fsState(): { existing: Set<string> } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ipcMod as any).__fsState
}

beforeEach(() => {
  useStore.setState({
    selectedPath: null,
    selectedPaths: new Set(),
    openDoc: null,
    expandedFolders: new Set(),
    pinnedPaths: [],
  })
  fsState().existing.clear()
  vi.mocked(ipcMod.ipc.renamePath).mockClear()
  vi.mocked(refreshDirectories).mockReset()
  vi.mocked(refreshDirectories).mockResolvedValue(undefined)
  saveHarness.begin.mockReset()
  saveHarness.remap.mockReset()
  saveHarness.discard.mockReset()
  saveHarness.release.mockReset()
  saveHarness.begin.mockResolvedValue({
    remap: saveHarness.remap,
    discard: saveHarness.discard,
    release: saveHarness.release,
  })
  usePromptStore.setState({ collision: null, confirm: null })
})

describe("moveItems", () => {
  it("moves files into target dir", async () => {
    fsState().existing.add("/root/a.md")
    fsState().existing.add("/root/b.md")
    const res = await moveItems(["/root/a.md", "/root/b.md"], "/root/notes")
    expect(res).toEqual({ moved: 2, skipped: 0, cancelled: false })
    expect(fsState().existing).toEqual(new Set(["/root/notes/a.md", "/root/notes/b.md"]))
  })

  it("skips moves where source is already in target dir", async () => {
    fsState().existing.add("/root/notes/a.md")
    const res = await moveItems(["/root/notes/a.md"], "/root/notes")
    expect(res).toEqual({ moved: 0, skipped: 0, cancelled: false })
  })

  it("follows the open doc to the new path", async () => {
    fsState().existing.add("/root/a.md")
    useStore.setState({
      selectedPath: "/root/a.md",
      selectedPaths: new Set(["/root/a.md"]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      openDoc: { path: "/root/a.md", text: "", dirty: false, savedAt: 0, parseError: null } as any,
    })
    await moveItems(["/root/a.md"], "/root/notes")
    const s = useStore.getState()
    expect(s.selectedPath).toBe("/root/notes/a.md")
    expect(Array.from(s.selectedPaths)).toEqual(["/root/notes/a.md"])
    expect(s.openDoc!.path).toBe("/root/notes/a.md")
  })

  it("remaps open doc when an ancestor folder is moved", async () => {
    fsState().existing.add("/root/notes")
    useStore.setState({
      selectedPath: "/root/notes/inner/deep.md",
      selectedPaths: new Set(["/root/notes/inner/deep.md"]),
      expandedFolders: new Set(["/root/notes", "/root/notes/inner"]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      openDoc: { path: "/root/notes/inner/deep.md", text: "", dirty: false, savedAt: 0, parseError: null } as any,
    })
    await moveItems(["/root/notes"], "/root/archive")
    const s = useStore.getState()
    expect(s.openDoc!.path).toBe("/root/archive/notes/inner/deep.md")
    expect(s.selectedPath).toBe("/root/archive/notes/inner/deep.md")
    expect(s.expandedFolders.has("/root/archive/notes")).toBe(true)
    expect(s.expandedFolders.has("/root/archive/notes/inner")).toBe(true)
  })

  it("remaps pinned files when a file or ancestor folder moves", async () => {
    fsState().existing.add("/root/a.md")
    fsState().existing.add("/root/notes")
    useStore.setState({ pinnedPaths: ["/root/a.md", "/root/notes/inner/deep.md"] })

    await moveItems(["/root/a.md"], "/root/archive")
    await moveItems(["/root/notes"], "/root/archive")

    expect(useStore.getState().pinnedPaths).toEqual([
      "/root/archive/a.md",
      "/root/archive/notes/inner/deep.md",
    ])
  })

  it("invokes the collision dialog and respects skip", async () => {
    fsState().existing.add("/root/a.md")
    fsState().existing.add("/root/notes/a.md")

    // Auto-respond to the collision modal: skip without apply-to-rest.
    const unsub = usePromptStore.subscribe((s) => {
      if (s.collision) {
        const req = s.collision
        usePromptStore.setState({ collision: null })
        req.resolve({ choice: "skip", applyToRest: false })
      }
    })

    const res = await moveItems(["/root/a.md"], "/root/notes")
    unsub()
    expect(res).toEqual({ moved: 0, skipped: 1, cancelled: false })
    // Source file is still in place; target file is also still in place.
    expect(fsState().existing.has("/root/a.md")).toBe(true)
    expect(fsState().existing.has("/root/notes/a.md")).toBe(true)
  })

  it("rename branch finds a non-colliding suffix", async () => {
    fsState().existing.add("/root/a.md")
    fsState().existing.add("/root/notes/a.md")

    const unsub = usePromptStore.subscribe((s) => {
      if (s.collision) {
        const req = s.collision
        usePromptStore.setState({ collision: null })
        req.resolve({ choice: "rename", applyToRest: false })
      }
    })

    const res = await moveItems(["/root/a.md"], "/root/notes")
    unsub()
    expect(res).toEqual({ moved: 1, skipped: 0, cancelled: false })
    expect(fsState().existing.has("/root/notes/a-1.md")).toBe(true)
  })

  it("cancel aborts remaining items", async () => {
    fsState().existing.add("/root/a.md")
    fsState().existing.add("/root/b.md")
    fsState().existing.add("/root/notes/a.md")

    const unsub = usePromptStore.subscribe((s) => {
      if (s.collision) {
        const req = s.collision
        usePromptStore.setState({ collision: null })
        req.resolve({ choice: "cancel", applyToRest: false })
      }
    })

    const res = await moveItems(["/root/a.md", "/root/b.md"], "/root/notes")
    unsub()
    expect(res.cancelled).toBe(true)
    // b.md was never moved because cancel hit first.
    expect(fsState().existing.has("/root/b.md")).toBe(true)
  })

  it("waits for the path guard and aborts before item one when it rejects", async () => {
    fsState().existing.add("/root/a.md")
    saveHarness.begin.mockRejectedValue(new Error("save failed"))

    await expect(moveItems(["/root/a.md"], "/root/notes")).rejects.toThrow("save failed")

    expect(saveHarness.begin).toHaveBeenCalledWith(["/root/a.md"])
    expect(ipcMod.ipc.renamePath).not.toHaveBeenCalled()
    expect(fsState().existing.has("/root/a.md")).toBe(true)
  })

  it("prunes selected descendants when their ancestor is also moved", async () => {
    fsState().existing.add("/root/folder")
    fsState().existing.add("/root/folder/child.md")

    await moveItems(["/root/folder/child.md", "/root/folder"], "/root/archive")

    expect(ipcMod.ipc.renamePath).toHaveBeenCalledTimes(1)
    expect(ipcMod.ipc.renamePath).toHaveBeenCalledWith(
      "/root/folder",
      "/root/archive/folder",
    )
  })

  it("remaps a collision move to its actual suffixed destination", async () => {
    fsState().existing.add("/root/a.md")
    fsState().existing.add("/root/notes/a.md")
    useStore.setState({
      selectedPath: "/root/a.md",
      selectedPaths: new Set(["/root/a.md"]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      openDoc: { path: "/root/a.md", text: "", dirty: false, savedAt: 0, parseError: null } as any,
    })
    const unsub = usePromptStore.subscribe((s) => {
      if (!s.collision) return
      const req = s.collision
      usePromptStore.setState({ collision: null })
      req.resolve({ choice: "rename", applyToRest: false })
    })

    await moveItems(["/root/a.md"], "/root/notes")
    unsub()

    expect(saveHarness.remap).toHaveBeenCalledWith(
      "/root/a.md",
      "/root/notes/a-1.md",
    )
    expect(useStore.getState().openDoc?.path).toBe("/root/notes/a-1.md")
  })

  it("keeps a successful remap and releases the guard when refresh fails", async () => {
    fsState().existing.add("/root/a.md")
    useStore.setState({
      selectedPath: "/root/a.md",
      selectedPaths: new Set(["/root/a.md"]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      openDoc: { path: "/root/a.md", text: "", dirty: false, savedAt: 0, parseError: null } as any,
    })
    vi.mocked(refreshDirectories).mockRejectedValueOnce(new Error("refresh failed"))

    await expect(moveItems(["/root/a.md"], "/root/notes")).rejects.toThrow("refresh failed")

    expect(useStore.getState().openDoc?.path).toBe("/root/notes/a.md")
    expect(saveHarness.release).toHaveBeenCalledTimes(1)
  })
})
