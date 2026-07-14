import React from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const retry = vi.fn()
const editorInstances = vi.hoisted(() => ({
  block: 0,
  raw: 0,
  blockCallbacks: [] as Array<(body: string) => void>,
}))

vi.mock("../useOpenFile", () => ({ useOpenFile: () => ({ retry }) }))
vi.mock("../useAutoSave", () => ({ useAutoSave: () => {} }))
vi.mock("../useAutoRename", () => ({ useAutoRename: () => {} }))
vi.mock("../BlockEditor", () => ({
  BlockEditor: ({ onChangeMarkdown }: { onChangeMarkdown: (body: string) => void }) => {
    const [instance] = React.useState(() => {
      editorInstances.blockCallbacks.push(onChangeMarkdown)
      return ++editorInstances.block
    })
    return <div data-testid="block-editor">Block editor surface {instance}</div>
  },
}))
vi.mock("../RawEditor", () => ({
  RawEditor: () => {
    const [instance] = React.useState(() => ++editorInstances.raw)
    return <div data-testid="raw-editor">Raw editor surface {instance}</div>
  },
}))
vi.mock("../FindBar", () => ({ FindBar: () => null }))

import { useStore } from "../../../lib/store"
import { EditorPane } from "../EditorPane"

describe("EditorPane compatibility wiring", () => {
  beforeEach(() => {
    retry.mockClear()
    editorInstances.block = 0
    editorInstances.raw = 0
    editorInstances.blockCallbacks = []
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
    await screen.findByTestId("raw-editor")

    fireEvent.click(screen.getByTitle("Block view (⌘E)"))

    expect(useStore.getState().editorMode).toBe("raw")
    expect(screen.getByTestId("raw-editor")).toBeInTheDocument()
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
    expect(await screen.findByTestId("block-editor")).toBeInTheDocument()
  })

  it("shows the retry state without mounting an editor after an initial read failure", () => {
    useStore.setState({
      loadError: { path: "/vault/missing.md", message: "missing file" },
    })

    render(<EditorPane />)

    expect(screen.getByRole("alert")).toHaveTextContent("missing file")
    expect(screen.queryByTestId("block-editor")).not.toBeInTheDocument()
    expect(screen.queryByTestId("raw-editor")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it("remounts BlockNote for same-body and populated-to-empty file loads but not renames", async () => {
    useStore.getState().openAnalyzedDocument("/vault/a.md", "Same body", "disk")
    render(<EditorPane />)
    expect(await screen.findByTestId("block-editor")).toHaveTextContent("1")

    act(() => {
      useStore.getState().openAnalyzedDocument("/vault/b.md", "Same body", "disk")
    })
    expect(await screen.findByTestId("block-editor")).toHaveTextContent("2")

    act(() => {
      useStore.getState().openAnalyzedDocument("/vault/empty.md", "", "disk")
    })
    expect(await screen.findByTestId("block-editor")).toHaveTextContent("3")

    const revision = useStore.getState().docRev
    act(() => useStore.getState().patchOpenDoc({ path: "/vault/renamed.md" }))
    expect(await screen.findByTestId("block-editor")).toHaveTextContent("3")
    expect(useStore.getState().docRev).toBe(revision)
  })

  it("remounts CodeMirror between notes so undo history cannot cross buffers", async () => {
    useStore.setState({ preferredEditorMode: "raw" })
    useStore.getState().openAnalyzedDocument("/vault/a.md", "first", "disk")
    render(<EditorPane />)
    expect(await screen.findByTestId("raw-editor")).toHaveTextContent("1")

    act(() => {
      useStore.getState().openAnalyzedDocument("/vault/b.md", "second", "disk")
    })
    expect(await screen.findByTestId("raw-editor")).toHaveTextContent("2")
  })

  it("remounts BlockNote exactly once for an accepted same-path external replacement", async () => {
    useStore.getState().openAnalyzedDocument("/vault/a.md", "Local body", "disk")
    render(<EditorPane />)
    expect(await screen.findByTestId("block-editor")).toHaveTextContent("1")
    const before = useStore.getState().docRev

    act(() => {
      useStore.getState().openAnalyzedDocument(
        "/vault/a.md",
        "Accepted external body",
        "external",
      )
    })

    expect(useStore.getState().docRev).toBe(before + 1)
    expect(await screen.findByTestId("block-editor")).toHaveTextContent("2")
    expect(useStore.getState().openDoc?.text).toBe("Accepted external body")
  })

  it("ignores a markdown export finishing after its note was replaced", async () => {
    useStore.getState().openAnalyzedDocument("/vault/a.md", "Old note", "disk")
    render(<EditorPane />)
    expect(await screen.findByTestId("block-editor")).toHaveTextContent("1")
    const staleExport = editorInstances.blockCallbacks[0]

    act(() => {
      useStore.getState().openAnalyzedDocument("/vault/b.md", "Fresh note", "disk")
    })
    expect(await screen.findByTestId("block-editor")).toHaveTextContent("2")

    act(() => staleExport("Stale export"))

    expect(useStore.getState().openDoc).toMatchObject({
      path: "/vault/b.md",
      text: "Fresh note",
      dirty: false,
    })
  })
})
