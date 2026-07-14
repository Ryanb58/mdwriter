import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const retry = vi.fn()

vi.mock("../useOpenFile", () => ({ useOpenFile: () => ({ retry }) }))
vi.mock("../useAutoSave", () => ({ useAutoSave: () => {} }))
vi.mock("../useAutoRename", () => ({ useAutoRename: () => {} }))
vi.mock("../BlockEditor", () => ({
  BlockEditor: () => <div>Block editor surface</div>,
}))
vi.mock("../RawEditor", () => ({
  RawEditor: () => <div>Raw editor surface</div>,
}))
vi.mock("../FindBar", () => ({ FindBar: () => null }))

import { useStore } from "../../../lib/store"
import { EditorPane } from "../EditorPane"

describe("EditorPane compatibility wiring", () => {
  beforeEach(() => {
    retry.mockClear()
    useStore.setState({
      rootPath: "/vault",
      tree: null,
      selectedPath: null,
      selectedPaths: new Set(),
      openDoc: null,
      editorMode: "block",
      preferredEditorMode: "block",
      loadError: null,
      blockModeOverrides: {},
      docRev: 0,
      focusMode: false,
    })
  })

  it("keeps a risky note raw when the segmented Block button is pressed", async () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A footnote[^one].",
      "disk",
    )
    render(<EditorPane />)
    await screen.findByText("Raw editor surface")

    fireEvent.click(screen.getByTitle("Block view (⌘E)"))

    expect(useStore.getState().editorMode).toBe("raw")
    expect(screen.getByText("Raw editor surface")).toBeInTheDocument()
  })

  it("uses the compatibility banner as the explicit override path", async () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A footnote[^one].",
      "disk",
    )
    render(<EditorPane />)

    fireEvent.click(await screen.findByRole("button", { name: "Edit in block mode anyway" }))

    await waitFor(() => expect(useStore.getState().editorMode).toBe("block"))
    expect(await screen.findByText("Block editor surface")).toBeInTheDocument()
  })

  it("shows the retry state without mounting an editor after an initial read failure", () => {
    useStore.setState({
      loadError: { path: "/vault/missing.md", message: "missing file" },
    })

    render(<EditorPane />)

    expect(screen.getByRole("alert")).toHaveTextContent("missing file")
    expect(screen.queryByText("Block editor surface")).not.toBeInTheDocument()
    expect(screen.queryByText("Raw editor surface")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
