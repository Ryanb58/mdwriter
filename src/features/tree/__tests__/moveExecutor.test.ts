import { describe, it, expect, beforeEach, vi } from "vitest"
import { useStore } from "../../../lib/store"
import { usePromptStore } from "../dndPrompts"

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

vi.mock("../useTreeActions", async () => ({
  refreshTree: vi.fn(async () => {}),
  useTreeActions: () => ({}),
}))

import { moveItems } from "../moveExecutor"
import * as ipcMod from "../../../lib/ipc"

function fsState(): { existing: Set<string> } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ipcMod as any).__fsState
}

beforeEach(() => {
  useStore.setState({ selectedPath: null, selectedPaths: new Set(), openDoc: null, expandedFolders: new Set() })
  fsState().existing.clear()
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
      openDoc: { path: "/root/a.md", frontmatter: {}, rawMarkdown: "", blocks: null, dirty: false, savedAt: 0, parseError: null } as any,
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
      openDoc: { path: "/root/notes/inner/deep.md", frontmatter: {}, rawMarkdown: "", blocks: null, dirty: false, savedAt: 0, parseError: null } as any,
    })
    await moveItems(["/root/notes"], "/root/archive")
    const s = useStore.getState()
    expect(s.openDoc!.path).toBe("/root/archive/notes/inner/deep.md")
    expect(s.selectedPath).toBe("/root/archive/notes/inner/deep.md")
    expect(s.expandedFolders.has("/root/archive/notes")).toBe(true)
    expect(s.expandedFolders.has("/root/archive/notes/inner")).toBe(true)
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
})
