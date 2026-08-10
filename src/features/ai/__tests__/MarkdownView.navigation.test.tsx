import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({ revealPath: vi.fn() }))
vi.mock("../../tree/treeLoader", () => ({ revealPath: harness.revealPath }))

import { useStore } from "../../../lib/store"
import { MarkdownView } from "../MarkdownView"

describe("MarkdownView note navigation", () => {
  beforeEach(() => {
    harness.revealPath.mockReset()
    harness.revealPath.mockResolvedValue("found")
    useStore.setState({
      rootPath: "/vault",
      selectedPath: null,
      selectedPaths: new Set(),
    })
  })

  it("reveals an assistant note link that lives outside the loaded tree", () => {
    render(<MarkdownView text="Open [[deep/note]]" />)

    fireEvent.click(screen.getByRole("button", { name: "deep/note" }))

    expect(useStore.getState().selectedPath).toBe("/vault/deep/note.md")
    expect(harness.revealPath).toHaveBeenCalledWith("/vault/deep/note.md")
  })

  it("renders malformed percent escapes without crashing the chat", () => {
    expect(() => render(<MarkdownView text="[note](mdwriter:%ZZ)" />)).not.toThrow()
    expect(screen.getByRole("button", { name: "note" })).toBeInTheDocument()
  })
})
