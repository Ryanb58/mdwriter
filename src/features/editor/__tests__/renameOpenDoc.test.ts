import { describe, it, expect, beforeEach, vi } from "vitest"

const saveHarness = vi.hoisted(() => ({
  begin: vi.fn(),
  remap: vi.fn(),
  discard: vi.fn(),
  release: vi.fn(),
}))

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
      writeFile: vi.fn(async (path: string, text: string) => {
        fs.existing.add(path)
        fs.writes.push({ path, body: text })
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

vi.mock("../../../lib/writeDoc", () => ({
  beginOpenDocPathMutation: saveHarness.begin,
}))

import { renameOpenDoc, RenameOpenDocError } from "../renameOpenDoc"
import { useStore } from "../../../lib/store"
import * as ipcMod from "../../../lib/ipc"
import { noteSelfWrite } from "../../watcher/useExternalChanges"
import { analyzeDocument } from "../../../lib/documentAnalysis"

function fs(): { existing: Set<string>; writes: Array<{ path: string; body: string }> } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ipcMod as any).__fs
}

beforeEach(() => {
  fs().existing.clear()
  fs().writes.length = 0
  vi.mocked(ipcMod.ipc.renamePath).mockClear()
  vi.mocked(ipcMod.ipc.writeFile).mockClear()
  saveHarness.begin.mockReset()
  saveHarness.remap.mockReset()
  saveHarness.discard.mockReset()
  saveHarness.release.mockReset()
  saveHarness.begin.mockResolvedValue({
    remap: saveHarness.remap,
    discard: saveHarness.discard,
    release: saveHarness.release,
  })
  ;(noteSelfWrite as ReturnType<typeof vi.fn>).mockClear()
  useStore.setState({
    selectedPath: null,
    selectedPaths: new Set(),
    openDoc: null,
    blockModeOverrides: {},
  })
})

function openAt(path: string, opts: { dirty?: boolean; body?: string } = {}) {
  const text = opts.body ?? "hello"
  fs().existing.add(path)
  useStore.setState({
    selectedPath: path,
    selectedPaths: new Set([path]),
    openDoc: {
      path,
      text,
      dirty: opts.dirty ?? false,
      savedAt: opts.dirty ? null : Date.now(),
      ...analyzeDocument(path, text),
      saveStatus: opts.dirty ? "queued" : "clean",
      saveError: null,
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

  it("awaits the path guard instead of writing dirty bytes directly", async () => {
    openAt("/vault/old.md", { dirty: true, body: "unsaved body" })
    await renameOpenDoc("new")
    expect(saveHarness.begin).toHaveBeenCalledWith(["/vault/old.md"])
    expect(fs().writes).toEqual([])
    const s = useStore.getState()
    expect(s.openDoc?.dirty).toBe(true)
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

  it("remaps a compatibility override with the renamed document", async () => {
    openAt("/vault/old.md", { body: "A footnote[^one]." })
    useStore.getState().overrideBlockModeForCurrentDoc()
    const fingerprint = useStore.getState().openDoc!.contentFingerprint

    await renameOpenDoc("new")

    expect(useStore.getState().blockModeOverrides).toEqual({
      "/vault/new.md": fingerprint,
    })
  })

  it("does not touch the filesystem when acquiring the guard fails", async () => {
    openAt("/vault/old.md", { dirty: true })
    saveHarness.begin.mockRejectedValue(new Error("disk full"))

    await expect(renameOpenDoc("new")).rejects.toThrow("disk full")

    expect(vi.mocked(ipcMod.ipc.renamePath)).not.toHaveBeenCalled()
    expect(useStore.getState().openDoc?.path).toBe("/vault/old.md")
  })

  it("keeps edits made during rename dirty and remaps before release", async () => {
    openAt("/vault/old.md")
    const rename = deferred<void>()
    vi.mocked(ipcMod.ipc.renamePath).mockImplementationOnce(async (from, to) => {
      await rename.promise
      fs().existing.delete(from)
      fs().existing.add(to)
    })

    const renaming = renameOpenDoc("new")
    await vi.waitFor(() => expect(ipcMod.ipc.renamePath).toHaveBeenCalled())
    useStore.getState().editOpenDoc("typed while renaming")
    rename.resolve()
    await renaming

    expect(useStore.getState().openDoc).toMatchObject({
      path: "/vault/new.md",
      text: "typed while renaming",
      dirty: true,
    })
    expect(saveHarness.remap).toHaveBeenCalledWith("/vault/old.md", "/vault/new.md")
    expect(saveHarness.release).toHaveBeenCalledTimes(1)
    expect(saveHarness.remap.mock.invocationCallOrder[0]).toBeLessThan(
      saveHarness.release.mock.invocationCallOrder[0],
    )
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}
