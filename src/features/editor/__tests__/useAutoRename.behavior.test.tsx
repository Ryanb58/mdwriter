import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useStore, type OpenDoc } from "../../../lib/store"
import { analyzeDocument } from "../../../lib/documentAnalysis"

// Mock the IPC + side-effect boundary so the hook runs without Tauri.
const renamePath = vi.fn((_from: string, _to: string) => Promise.resolve())
const saveHarness = vi.hoisted(() => ({
  begin: vi.fn(),
  remap: vi.fn(),
  discard: vi.fn(),
  release: vi.fn(),
}))
vi.mock("../../../lib/ipc", () => ({
  ipc: { renamePath: (from: string, to: string) => renamePath(from, to) },
}))
vi.mock("../../tree/treeLoader", () => ({ refreshDirectories: vi.fn(async () => {}) }))
vi.mock("../watcher/useExternalChanges", () => ({ noteSelfWrite: vi.fn() }))
vi.mock("../../../lib/writeDoc", () => ({
  beginOpenDocPathMutation: saveHarness.begin,
}))

import { useAutoRename } from "../useAutoRename"

const VAULT = "/vault"
const UNTITLED = `${VAULT}/untitled.md`

function setDoc(d: Partial<OpenDoc> & { path: string }) {
  const text = d.text ?? ""
  useStore.setState({
    openDoc: {
      dirty: false,
      savedAt: 1,
      text,
      ...analyzeDocument(d.path, text),
      saveStatus: "clean",
      saveError: null,
      diskDigest: null,
      ...d,
    },
    selectedPath: d.path,
    selectedPaths: new Set([d.path]),
  })
}

describe("useAutoRename — keystroke sequence", () => {
  beforeEach(() => {
    renamePath.mockClear()
    renamePath.mockResolvedValue(undefined)
    saveHarness.begin.mockReset()
    saveHarness.remap.mockReset()
    saveHarness.discard.mockReset()
    saveHarness.release.mockReset()
    saveHarness.begin.mockResolvedValue({
      remap: saveHarness.remap,
      discard: saveHarness.discard,
      release: saveHarness.release,
    })
    useStore.setState({
      openDoc: null,
      headingCommittedPath: null,
      selectedPath: null,
      selectedPaths: new Set(),
      settings: { ...useStore.getState().settings, autoRenameFromH1: true },
    })
  })

  it("does NOT rename while the H1 is still being typed (block mode, single heading block)", async () => {
    renderHook(() => useAutoRename())

    // Type "# 2026-06" — block editor serializes a lone heading as "# x\n",
    // and the block signal is null because there's no block after the H1.
    await act(async () => {
      setDoc({ path: UNTITLED, text: "# 2026-06\n", dirty: false, savedAt: 1 })
    })
    expect(renamePath).not.toHaveBeenCalled()

    // Autosave settles again after another keystroke pause ("# 2026-06-0").
    await act(async () => {
      setDoc({ path: UNTITLED, text: "# 2026-06-0\n", dirty: false, savedAt: 2 })
    })
    expect(renamePath).not.toHaveBeenCalled()
  })

  it("renames once the block editor reports the heading committed (Enter pressed)", async () => {
    renderHook(() => useAutoRename())

    await act(async () => {
      setDoc({ path: UNTITLED, text: "# 2026-06-06\n", dirty: false, savedAt: 1 })
    })
    expect(renamePath).not.toHaveBeenCalled()

    // Enter pressed → a block now exists after the H1 → editor sets the signal.
    await act(async () => {
      useStore.getState().setHeadingCommittedPath(UNTITLED)
    })

    expect(renamePath).toHaveBeenCalledWith(UNTITLED, `${VAULT}/2026-06-06.md`)
    // The commitment signal is remapped off the old untitled path, so a future
    // note reusing "untitled.md" can't inherit a stale "committed" state.
    expect(useStore.getState().headingCommittedPath).toBe(`${VAULT}/2026-06-06.md`)
  })

  it("does not treat a reused untitled.md as committed after a prior rename", async () => {
    renderHook(() => useAutoRename())

    // First note: commit + rename untitled.md → first.md.
    await act(async () => {
      setDoc({ path: UNTITLED, text: "# First\n", dirty: false, savedAt: 1 })
      useStore.getState().setHeadingCommittedPath(UNTITLED)
    })
    expect(renamePath).toHaveBeenCalledWith(UNTITLED, `${VAULT}/first.md`)
    renamePath.mockClear()

    // Second new note reuses the untitled.md path; user has only typed a
    // partial heading and has NOT committed (signal should not be inherited).
    await act(async () => {
      setDoc({ path: UNTITLED, text: "# Secon\n", dirty: false, savedAt: 2 })
    })
    expect(renamePath).not.toHaveBeenCalled()
  })

  it("surfaces a non-collision rename error instead of spinning suffixes", async () => {
    renamePath.mockRejectedValueOnce({ kind: "Io", message: "permission denied" })
    renderHook(() => useAutoRename())

    await act(async () => {
      setDoc({ path: UNTITLED, text: "# Doc\n\nbody", dirty: false, savedAt: 1 })
    })

    // Exactly one attempt — the real error is thrown, not retried 200×.
    expect(renamePath).toHaveBeenCalledTimes(1)
  })

  it("retries the next suffix on a real name collision", async () => {
    renamePath.mockRejectedValueOnce({ kind: "Io", message: "destination exists: /vault/doc.md" })
    renderHook(() => useAutoRename())

    await act(async () => {
      setDoc({ path: UNTITLED, text: "# Doc\n\nbody", dirty: false, savedAt: 1 })
    })

    expect(renamePath).toHaveBeenNthCalledWith(1, UNTITLED, `${VAULT}/doc.md`)
    expect(renamePath).toHaveBeenNthCalledWith(2, UNTITLED, `${VAULT}/doc-2.md`)
    expect(saveHarness.remap).toHaveBeenCalledWith(UNTITLED, `${VAULT}/doc-2.md`)
    expect(useStore.getState().openDoc?.path).toBe(`${VAULT}/doc-2.md`)
  })

  it("renames in raw mode once body content follows the heading", async () => {
    renderHook(() => useAutoRename())

    await act(async () => {
      setDoc({ path: UNTITLED, text: "# Meeting notes\n\nagenda", dirty: false, savedAt: 1 })
    })

    expect(renamePath).toHaveBeenCalledWith(UNTITLED, `${VAULT}/meeting-notes.md`)
  })

  it("renames the note you LEAVE when it has an uncommitted H1 (clicked away, no Enter)", async () => {
    const OTHER = `${VAULT}/other.md`
    const { rerender } = renderHook(() => useAutoRename())

    // 1. Type a title — doc is dirty while typing.
    await act(async () => {
      setDoc({ path: UNTITLED, text: "# Grocery list\n", dirty: true, savedAt: null })
    })
    rerender()
    // 2. Autosave settles: flips dirty→false + sets savedAt, WITHOUT touching
    //    path or text (this is what the real autosave does).
    await act(async () => {
      useStore.getState().patchOpenDoc({ dirty: false, savedAt: 1 })
    })
    rerender()
    expect(renamePath).not.toHaveBeenCalled() // not committed → no rename yet

    // 3. Click another file: openDoc switches to other.md.
    await act(async () => {
      setDoc({ path: OTHER, text: "already named\n", dirty: false, savedAt: 5 })
    })
    rerender()

    expect(renamePath).toHaveBeenCalledWith(UNTITLED, `${VAULT}/grocery-list.md`)
  })

  it("does NOT rename the left note if it was still dirty (sub-500ms fast switch)", async () => {
    const OTHER = `${VAULT}/other.md`
    const { rerender } = renderHook(() => useAutoRename())

    await act(async () => {
      setDoc({ path: UNTITLED, text: "# Quick note\n", dirty: true, savedAt: null })
    })
    rerender()
    await act(async () => {
      setDoc({ path: OTHER, text: "x\n", dirty: false, savedAt: 5 })
    })
    rerender()

    expect(renamePath).not.toHaveBeenCalled() // the gap: dirty doc is skipped
  })

  it("does not rename a dirty (mid-save) doc even when committed", async () => {
    renderHook(() => useAutoRename())

    await act(async () => {
      setDoc({ path: UNTITLED, text: "# Title\n\nbody", dirty: true, savedAt: 1 })
    })
    expect(renamePath).not.toHaveBeenCalled()
  })

  it("does not rename when the open-path save guard fails", async () => {
    saveHarness.begin.mockRejectedValue(new Error("disk full"))
    renderHook(() => useAutoRename())

    await act(async () => {
      setDoc({ path: UNTITLED, text: "# Title\n\nbody", dirty: false, savedAt: 1 })
    })

    expect(saveHarness.begin).toHaveBeenCalledWith([UNTITLED])
    expect(renamePath).not.toHaveBeenCalled()
  })
})
