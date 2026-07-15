import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../../../lib/store"

const ipcHarness = vi.hoisted(() => ({ searchVault: vi.fn() }))

vi.mock("../../../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/ipc")>()
  return { ...actual, ipc: { ...actual.ipc, searchVault: ipcHarness.searchVault } }
})

import { SearchMode } from "../SearchMode"

describe("SearchMode reveal targets", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    useStore.setState({
      rootPath: "/vault",
      selectedPath: null,
      selectedPaths: new Set(),
      pendingScroll: null,
    })
    ipcHarness.searchVault.mockResolvedValue({
      hits: [{
        path: "/vault/notes/result.md",
        line: 12,
        colStart: 6,
        colEnd: 12,
        snippet: "alpha needle omega",
      }],
      truncated: false,
      filesScanned: 3,
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("keeps vault search on its own reveal payload and selection behavior", async () => {
    const close = vi.fn()
    render(<SearchMode initialQuery="needle" onQueryChange={vi.fn()} close={close} />)

    await act(async () => {
      vi.advanceTimersByTime(180)
      await Promise.resolve()
      await Promise.resolve()
    })
    const result = screen.getByText("needle")
    fireEvent.mouseDown(result.closest("[data-hit-idx]")!)

    expect(useStore.getState().pendingScroll).toEqual({
      kind: "vault-reveal",
      path: "/vault/notes/result.md",
      line: 12,
      matchText: "needle",
      occurrence: 0,
    })
    expect(useStore.getState().selectedPath).toBe("/vault/notes/result.md")
    expect(close).toHaveBeenCalledTimes(1)
  })
})
