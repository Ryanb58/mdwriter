import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { useStore } from "../../../lib/store"
import { MarkdownCompatibilityBanner } from "../MarkdownCompatibilityBanner"

describe("MarkdownCompatibilityBanner", () => {
  beforeEach(() => {
    useStore.setState({
      openDoc: null,
      preferredEditorMode: "block",
      editorMode: "block",
      blockModeOverrides: {},
    })
  })

  it("stays hidden for a safe document", () => {
    useStore.getState().openAnalyzedDocument("/vault/safe.md", "# Safe", "disk")

    const { container } = render(<MarkdownCompatibilityBanner />)

    expect(container).toBeEmptyDOMElement()
  })

  it("names the constructs that need raw-source preservation", () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A note[^one].\n\n<div>Raw HTML</div>",
      "disk",
    )

    render(<MarkdownCompatibilityBanner />)

    expect(screen.getByRole("status")).toHaveTextContent("footnotes")
    expect(screen.getByRole("status")).toHaveTextContent("raw HTML blocks")
  })

  it("makes the explicit banner action the override path and remains visible afterward", () => {
    useStore.setState({ preferredEditorMode: "raw" })
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A note[^one].",
      "disk",
    )

    render(<MarkdownCompatibilityBanner />)
    fireEvent.click(screen.getByRole("button", { name: "Edit in block mode anyway" }))

    expect(useStore.getState().editorMode).toBe("block")
    expect(useStore.getState().preferredEditorMode).toBe("raw")
    expect(screen.getByRole("status")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Edit in block mode anyway" }),
    ).not.toBeInTheDocument()
  })
})
