import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useStore, type OpenDoc } from "../../../lib/store"

// Mock the IPC + side-effect boundary so the hook runs without Tauri.
const renamePath = vi.fn((_from: string, _to: string) => Promise.resolve())
vi.mock("../../../lib/ipc", () => ({
  ipc: { renamePath: (from: string, to: string) => renamePath(from, to) },
}))
vi.mock("../tree/useTreeActions", () => ({ refreshTree: vi.fn(async () => {}) }))
vi.mock("../watcher/useExternalChanges", () => ({ noteSelfWrite: vi.fn() }))

import { useAutoRename } from "../useAutoRename"

const VAULT = "/vault"
const UNTITLED = `${VAULT}/untitled.md`

function setDoc(d: Partial<OpenDoc> & { path: string }) {
  useStore.setState({
    openDoc: { dirty: false, savedAt: 1, parseError: null, text: "", ...d },
    selectedPath: d.path,
    selectedPaths: new Set([d.path]),
  })
}

describe("useAutoRename — keystroke sequence", () => {
  beforeEach(() => {
    renamePath.mockClear()
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
})
