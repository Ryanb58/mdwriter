import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../../lib/ipc", () => {
  const fs: { existing: Set<string>; writes: Array<{ path: string; body: string }> } = {
    existing: new Set(),
    writes: [],
  }
  return {
    __fs: fs,
    ipc: {
      renamePath: vi.fn(async (from: string, to: string) => {
        if (fs.existing.has(to)) throw new Error(`destination exists: ${to}`)
        if (!fs.existing.has(from)) throw new Error(`not found: ${from}`)
        fs.existing.delete(from)
        fs.existing.add(to)
      }),
      writeFile: vi.fn(async (path: string, contents: { frontmatter: Record<string, unknown>; body: string }) => {
        fs.existing.add(path)
        fs.writes.push({ path, body: contents.body })
      }),
      listTree: vi.fn(async () => ({ kind: "dir", name: "root", path: "/vault", children: [] })),
    },
  }
})

vi.mock("../../watcher/useExternalChanges", () => ({
  noteSelfWrite: vi.fn(),
}))

vi.mock("../../tree/useTreeActions", () => ({
  refreshTree: vi.fn(async () => {}),
}))

const cancelSpy = vi.fn()
vi.mock("../useAutoSave", () => ({
  cancelPendingDocSave: () => cancelSpy(),
}))

import { renameOpenDoc, RenameOpenDocError } from "../renameOpenDoc"
import { useStore } from "../../../lib/store"
import * as ipcMod from "../../../lib/ipc"
import { noteSelfWrite } from "../../watcher/useExternalChanges"

function fs(): { existing: Set<string>; writes: Array<{ path: string; body: string }> } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ipcMod as any).__fs
}

beforeEach(() => {
  fs().existing.clear()
  fs().writes.length = 0
  cancelSpy.mockClear()
  ;(noteSelfWrite as ReturnType<typeof vi.fn>).mockClear()
  useStore.setState({
    selectedPath: null,
    selectedPaths: new Set(),
    openDoc: null,
  })
})

function openAt(path: string, opts: { dirty?: boolean; body?: string } = {}) {
  fs().existing.add(path)
  useStore.setState({
    selectedPath: path,
    selectedPaths: new Set([path]),
    openDoc: {
      path,
      frontmatter: {},
      rawMarkdown: opts.body ?? "hello",
      blocks: null,
      dirty: opts.dirty ?? false,
      savedAt: opts.dirty ? null : Date.now(),
      parseError: null,
    },
  })
}

describe("renameOpenDoc", () => {
  it("renames a clean file and updates the store", async () => {
    openAt("/vault/old.md")
    await renameOpenDoc("new")
    expect(fs().existing.has("/vault/new.md")).toBe(true)
    expect(fs().existing.has("/vault/old.md")).toBe(false)
    const s = useStore.getState()
    expect(s.openDoc?.path).toBe("/vault/new.md")
    expect(s.selectedPath).toBe("/vault/new.md")
    expect(s.selectedPaths.has("/vault/new.md")).toBe(true)
    expect(s.selectedPaths.has("/vault/old.md")).toBe(false)
    // No write for a clean doc — only the rename touched disk.
    expect(fs().writes).toEqual([])
  })

  it("preserves the original extension when the user omits it", async () => {
    openAt("/vault/notes.markdown")
    await renameOpenDoc("scratch")
    expect(fs().existing.has("/vault/scratch.markdown")).toBe(true)
  })

  it("honours an explicit extension provided by the user", async () => {
    openAt("/vault/notes.md")
    await renameOpenDoc("scratch.txt")
    expect(fs().existing.has("/vault/scratch.txt")).toBe(true)
  })

  it("saves dirty content before renaming and cancels pending autosave", async () => {
    openAt("/vault/old.md", { dirty: true, body: "unsaved body" })
    await renameOpenDoc("new")
    expect(fs().writes).toEqual([{ path: "/vault/old.md", body: "unsaved body" }])
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    const s = useStore.getState()
    expect(s.openDoc?.dirty).toBe(false)
    expect(s.openDoc?.path).toBe("/vault/new.md")
  })

  it("rejects names containing path separators", async () => {
    openAt("/vault/old.md")
    await expect(renameOpenDoc("nested/new")).rejects.toBeInstanceOf(RenameOpenDocError)
    expect(fs().existing.has("/vault/old.md")).toBe(true)
  })

  it("rejects an empty / whitespace name", async () => {
    openAt("/vault/old.md")
    await expect(renameOpenDoc("   ")).rejects.toBeInstanceOf(RenameOpenDocError)
    expect(fs().existing.has("/vault/old.md")).toBe(true)
  })

  it("rejects an unchanged name (no-op)", async () => {
    openAt("/vault/old.md")
    await expect(renameOpenDoc("old")).rejects.toMatchObject({ reason: "unchanged" })
  })

  it("leaves the store unchanged when the IPC rename fails on collision", async () => {
    openAt("/vault/old.md")
    fs().existing.add("/vault/taken.md")
    await expect(renameOpenDoc("taken")).rejects.toMatchObject({ reason: "ipc-failed" })
    const s = useStore.getState()
    expect(s.openDoc?.path).toBe("/vault/old.md")
    expect(s.selectedPath).toBe("/vault/old.md")
  })
})
