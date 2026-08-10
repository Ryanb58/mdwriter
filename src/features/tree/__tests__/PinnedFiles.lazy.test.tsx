import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({ revealPath: vi.fn() }))
vi.mock("../treeLoader", () => ({ revealPath: harness.revealPath }))

import { useStore } from "../../../lib/store"
import { PinnedFiles } from "../PinnedFiles"

describe("PinnedFiles with a partial sidebar tree", () => {
  beforeEach(() => {
    harness.revealPath.mockReset()
    harness.revealPath.mockResolvedValue("found")
    useStore.setState({
      rootPath: "/vault",
      tree: {
        kind: "dir",
        name: "vault",
        path: "/vault",
        loaded: true,
        children: [
          { kind: "dir", name: "deep", path: "/vault/deep", loaded: false, children: [] },
        ],
      },
      pinnedPaths: ["/vault/deep/note.md"],
      selectedPath: null,
      selectedPaths: new Set(),
    })
  })

  it("opens and reveals a valid pin outside the loaded tree", () => {
    render(<PinnedFiles />)

    const pin = screen.getByText("note").closest("div[title]")
    expect(pin).toHaveAttribute("title", "deep/note.md")
    fireEvent.click(pin!)

    expect(useStore.getState().selectedPath).toBe("/vault/deep/note.md")
    expect(harness.revealPath).toHaveBeenCalledWith("/vault/deep/note.md")
  })

  it("does not select a pin outside the active vault", () => {
    useStore.setState({ pinnedPaths: ["/other/note.md"] })
    render(<PinnedFiles />)

    const pin = screen.getByText("note").closest("div[title]")
    fireEvent.click(pin!)

    expect(useStore.getState().selectedPath).toBeNull()
    expect(harness.revealPath).not.toHaveBeenCalled()
  })

  it("does not select a pin when no vault is open", () => {
    useStore.setState({ rootPath: null })
    render(<PinnedFiles />)

    fireEvent.click(screen.getByText("note").closest("div[title]")!)

    expect(useStore.getState().selectedPath).toBeNull()
    expect(harness.revealPath).not.toHaveBeenCalled()
  })
})
