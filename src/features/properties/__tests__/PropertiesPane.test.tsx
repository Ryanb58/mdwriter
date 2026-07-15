import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { useStore } from "../../../lib/store"
import { PropertiesPane } from "../PropertiesPane"

describe("PropertiesPane content edits", () => {
  beforeEach(() => {
    useStore.setState({
      openDoc: null,
      editorMode: "block",
      preferredEditorMode: "block",
      blockModeOverrides: {},
      loadError: null,
    })
  })

  it("routes frontmatter edits through the analyzed content action", () => {
    useStore.getState().openAnalyzedDocument("/vault/note.md", "# Note", "disk")
    useStore.getState().patchOpenDoc({ saveStatus: "error", saveError: "disk full" })
    render(<PropertiesPane />)

    fireEvent.click(screen.getByRole("button", { name: "Add field" }))
    fireEvent.change(screen.getByRole("textbox", { name: "New property name" }), {
      target: { value: "status" },
    })
    const value = screen.getByRole("textbox", { name: "New property value" })
    fireEvent.change(value, { target: { value: "draft" } })
    fireEvent.keyDown(value, { key: "Enter" })

    expect(useStore.getState().openDoc).toMatchObject({
      dirty: true,
      saveStatus: "queued",
      saveError: null,
      markdownRisks: [],
    })
    expect(useStore.getState().openDoc?.text).toContain("status: draft")
  })

  it("does not expose retained-note fields while another file has a load error", () => {
    useStore.getState().openAnalyzedDocument("/vault/previous.md", "# Previous", "disk")
    useStore.setState({
      loadError: { path: "/vault/unreadable.md", message: "permission denied" },
    })

    render(<PropertiesPane />)

    expect(screen.getByText(/resolve the file load error/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add field" })).not.toBeInTheDocument()
    expect(useStore.getState().openDoc?.text).toBe("# Previous")
  })
})
