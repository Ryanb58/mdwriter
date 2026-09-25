import { act, fireEvent, render, screen, within } from "@testing-library/react"
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
      pendingScroll: null,
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
    expect(screen.getByRole("status")).toHaveTextContent("Block mode is enabled")
    expect(screen.getByRole("status")).not.toHaveTextContent("Raw mode protects")
    expect(useStore.getState().openDoc?.text).toBe("A note[^one].")
    expect(useStore.getState().openDoc?.dirty).toBe(false)
  })

  it("explains the risk and discloses exact full-file locations and literal snippets", () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "---\ntitle: Note\n---\n\nOne[^a] and two[^b].\n<div>Raw HTML</div>",
      "disk",
    )
    const { container } = render(<MarkdownCompatibilityBanner />)
    const toggle = screen.getByRole("button", { name: "Inspect compatibility details (2)" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("region", { name: "Markdown compatibility details" })).toBeNull()
    expect(screen.getByRole("status")).toHaveTextContent("BlockNote may not round-trip")
    expect(screen.getByRole("status")).toHaveTextContent("change or lose their source")

    fireEvent.click(toggle)
    const details = screen.getByRole("region", { name: "Markdown compatibility details" })
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(toggle).toHaveAttribute("aria-controls", details.id)
    expect(within(details).getByText("Footnote references and definitions may be flattened or lost.")).toBeVisible()
    expect(within(details).getByRole("button", { name: "Show footnotes at line 5, column 4 in raw mode" })).toHaveTextContent("One[^a] and two[^b].")
    expect(within(details).getByRole("button", { name: "Show footnotes at line 5, column 16 in raw mode" })).toBeVisible()
    expect(within(details).getByText("<div>Raw HTML</div>")).toBeVisible()
    expect(container.querySelector("code div")).toBeNull()
    expect(useStore.getState().blockModeOverrides).toEqual({})
    expect(useStore.getState().editorMode).toBe("raw")
    expect(useStore.getState().openDoc?.dirty).toBe(false)

    fireEvent.click(toggle)
    expect(screen.queryByRole("region")).toBeNull()
  })

  it("shows a multiline range and the YAML parser's explanation", () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md", '---\ntitle: "bad\\q"\n---\n\n> First\n>\n> Second', "disk",
    )
    render(<MarkdownCompatibilityBanner />)
    fireEvent.click(screen.getByRole("button", { name: /Inspect compatibility/ }))
    expect(screen.getByText("Lines 5–7, col 1")).toBeVisible()
    expect(screen.getByText(useStore.getState().openDoc!.parseError!)).toBeVisible()
  })

  it("reveals the selected occurrence in raw mode, accounting for CRLF and emoji", () => {
    const text = "---\r\ntitle: Note\r\n---\r\n\r\n😀 [^a] then [^a]"
    useStore.getState().openAnalyzedDocument("/vault/risky.md", text, "disk")
    render(<MarkdownCompatibilityBanner />)
    fireEvent.click(screen.getByRole("button", { name: /Inspect compatibility/ }))
    fireEvent.click(screen.getByRole("button", { name: "Edit in block mode anyway" }))
    fireEvent.click(screen.getByRole("button", { name: "Show footnotes at line 5, column 13 in raw mode" }))
    const normalized = text.replace(/\r\n/g, "\n")
    expect(useStore.getState().editorMode).toBe("raw")
    expect(useStore.getState().pendingScroll).toMatchObject({
      kind: "find-raw",
      path: "/vault/risky.md",
      from: normalized.lastIndexOf("[^a]"),
      to: normalized.length,
    })
    expect(useStore.getState().openDoc?.text).toBe(text)
    expect(useStore.getState().openDoc?.dirty).toBe(false)
  })

  it("returns to raw mode without rewriting the note", () => {
    useStore.getState().openAnalyzedDocument("/vault/risky.md", "A[^a]", "disk")
    render(<MarkdownCompatibilityBanner />)
    fireEvent.click(screen.getByRole("button", { name: "Edit in block mode anyway" }))
    fireEvent.click(screen.getByRole("button", { name: "Return to raw mode" }))
    expect(useStore.getState().editorMode).toBe("raw")
    expect(useStore.getState().openDoc?.text).toBe("A[^a]")
    expect(screen.getByRole("status")).toHaveTextContent("Raw mode protects")
  })

  it("updates locations while editing and resets disclosure on a different note", () => {
    useStore.getState().openAnalyzedDocument("/vault/first.md", "A[^a]", "disk")
    render(<MarkdownCompatibilityBanner />)
    fireEvent.click(screen.getByRole("button", { name: /Inspect compatibility/ }))
    act(() => useStore.getState().editOpenDoc("\nA[^a]"))
    expect(screen.getByRole("button", { name: "Show footnotes at line 2, column 2 in raw mode" })).toBeVisible()
    act(() => useStore.getState().openAnalyzedDocument("/vault/second.md", "B[^b]", "disk"))
    expect(screen.queryByRole("region")).toBeNull()
    expect(screen.getByRole("button", { name: /Inspect compatibility/ })).toHaveAttribute("aria-expanded", "false")
    act(() => useStore.getState().editOpenDoc("Safe"))
    expect(screen.queryByRole("status")).toBeNull()
  })
})
