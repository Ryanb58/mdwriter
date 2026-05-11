import { describe, it, expect } from "vitest"
import { plainPasteToBlocks } from "../plainPaste"

describe("plainPasteToBlocks", () => {
  it("returns the whole string as the first line for single-line input", () => {
    const { firstLine, tailBlocks } = plainPasteToBlocks("hello world")
    expect(firstLine).toBe("hello world")
    expect(tailBlocks).toEqual([])
  })

  it("splits multi-line input into a first line plus paragraph blocks", () => {
    const { firstLine, tailBlocks } = plainPasteToBlocks("a\nb\nc")
    expect(firstLine).toBe("a")
    expect(tailBlocks).toEqual([
      { type: "paragraph", content: "b" },
      { type: "paragraph", content: "c" },
    ])
  })

  it("normalizes CRLF and bare CR line endings", () => {
    const crlf = plainPasteToBlocks("a\r\nb")
    expect(crlf.firstLine).toBe("a")
    expect(crlf.tailBlocks).toEqual([{ type: "paragraph", content: "b" }])

    const cr = plainPasteToBlocks("a\rb")
    expect(cr.firstLine).toBe("a")
    expect(cr.tailBlocks).toEqual([{ type: "paragraph", content: "b" }])
  })

  it("preserves empty lines as empty paragraphs", () => {
    const { firstLine, tailBlocks } = plainPasteToBlocks("a\n\nb")
    expect(firstLine).toBe("a")
    expect(tailBlocks).toEqual([
      { type: "paragraph", content: "" },
      { type: "paragraph", content: "b" },
    ])
  })

  it("does not interpret markdown syntax", () => {
    const { firstLine, tailBlocks } = plainPasteToBlocks("**bold**\n# heading")
    expect(firstLine).toBe("**bold**")
    expect(tailBlocks).toEqual([{ type: "paragraph", content: "# heading" }])
  })

  it("handles empty input", () => {
    const { firstLine, tailBlocks } = plainPasteToBlocks("")
    expect(firstLine).toBe("")
    expect(tailBlocks).toEqual([])
  })
})
