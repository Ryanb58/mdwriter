import { describe, it, expect } from "vitest"
import {
  preprocessWikilinks,
  postprocessWikilinks,
  hydrateWikilinkBlocks,
} from "../wikilinkRoundtrip"

describe("preprocessWikilinks", () => {
  it("swaps [[X]] for a sentinel", () => {
    const pre = preprocessWikilinks("See [[Three laws of motion]] for more.")
    expect(pre).not.toContain("[[")
    expect(pre).toContain("‹WL:")
  })
  it("preserves alias syntax in the sentinel", () => {
    const pre = preprocessWikilinks("[[Three laws of motion|3 laws]]")
    expect(pre).toContain("‹WL:")
    expect(pre).toContain(encodeURIComponent("Three laws of motion|3 laws"))
  })
  it("leaves bracketed text that isn't a wikilink alone", () => {
    const pre = preprocessWikilinks("a [single] bracket [pair]")
    expect(pre).toBe("a [single] bracket [pair]")
  })
})

describe("postprocessWikilinks", () => {
  it("unescapes BlockNote-escaped brackets", () => {
    const md = "See \\[\\[Three laws of motion\\]\\] for more."
    expect(postprocessWikilinks(md)).toBe("See [[Three laws of motion]] for more.")
  })
  it("converts sentinels back to wikilinks (safety net)", () => {
    const pre = preprocessWikilinks("[[Inertia]]")
    expect(postprocessWikilinks(pre)).toBe("[[Inertia]]")
  })
  it("is a no-op on plain markdown", () => {
    expect(postprocessWikilinks("hello **world**")).toBe("hello **world**")
  })
})

describe("hydrateWikilinkBlocks", () => {
  it("splits a text inline containing a sentinel into [text, wikilink, text]", () => {
    const pre = preprocessWikilinks("Before [[Note]] after")
    const blocks = [
      {
        type: "paragraph",
        content: [{ type: "text", text: pre, styles: {} }],
      },
    ]
    const out = hydrateWikilinkBlocks(blocks as never) as Array<{
      content: Array<{ type: string; text?: string; props?: { target?: string } }>
    }>
    const content = out[0].content
    expect(content).toHaveLength(3)
    expect(content[0]).toMatchObject({ type: "text", text: "Before " })
    expect(content[1]).toMatchObject({ type: "wikilink", props: { target: "Note", alias: "" } })
    expect(content[2]).toMatchObject({ type: "text", text: " after" })
  })

  it("captures alias from sentinel", () => {
    const pre = preprocessWikilinks("[[Note.md|pretty]]")
    const blocks = [
      {
        type: "paragraph",
        content: [{ type: "text", text: pre, styles: {} }],
      },
    ]
    const out = hydrateWikilinkBlocks(blocks as never) as Array<{
      content: Array<{ type: string; props?: { target?: string; alias?: string } }>
    }>
    expect(out[0].content[0]).toMatchObject({
      type: "wikilink",
      props: { target: "Note", alias: "pretty" },
    })
  })

  it("recurses into children blocks", () => {
    const pre = preprocessWikilinks("[[Nested]]")
    const blocks = [
      {
        type: "bulletListItem",
        content: [],
        children: [
          {
            type: "paragraph",
            content: [{ type: "text", text: pre, styles: {} }],
          },
        ],
      },
    ]
    const out = hydrateWikilinkBlocks(blocks as never) as Array<{
      children: Array<{ content: Array<{ type: string; props?: { target?: string } }> }>
    }>
    expect(out[0].children[0].content[0]).toMatchObject({
      type: "wikilink",
      props: { target: "Nested" },
    })
  })

  it("leaves plain text untouched", () => {
    const blocks = [
      {
        type: "paragraph",
        content: [{ type: "text", text: "just text", styles: {} }],
      },
    ]
    const out = hydrateWikilinkBlocks(blocks as never) as Array<{
      content: Array<{ type: string; text?: string }>
    }>
    expect(out[0].content).toHaveLength(1)
    expect(out[0].content[0]).toMatchObject({ type: "text", text: "just text" })
  })
})
