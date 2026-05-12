import { describe, it, expect } from "vitest"
import { extractBlockText, findNthBlockMatch } from "../blockTextSearch"

describe("extractBlockText", () => {
  it("returns text from a single text run", () => {
    const block = {
      id: "1",
      type: "paragraph",
      content: [{ type: "text", text: "hello world" }],
    }
    expect(extractBlockText(block)).toBe("hello world")
  })

  it("concatenates multiple inline text runs", () => {
    const block = {
      content: [
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
      ],
    }
    expect(extractBlockText(block)).toBe("hello world")
  })

  it("renders our wikilink atom as alias or target", () => {
    const block = {
      content: [
        { type: "text", text: "see " },
        { type: "wikilink", props: { target: "notes/foo", alias: "Foo!" } },
        { type: "text", text: " for context" },
      ],
    }
    expect(extractBlockText(block)).toBe("see Foo! for context")
  })

  it("falls back to target when alias is empty", () => {
    const block = {
      content: [{ type: "wikilink", props: { target: "Foo", alias: "" } }],
    }
    expect(extractBlockText(block)).toBe("Foo")
  })

  it("descends into nested content arrays (e.g. links)", () => {
    const block = {
      content: [
        { type: "text", text: "click " },
        { type: "link", content: [{ type: "text", text: "here" }] },
      ],
    }
    expect(extractBlockText(block)).toBe("click here")
  })

  it("returns empty string for unknown content shapes", () => {
    expect(extractBlockText(null)).toBe("")
    expect(extractBlockText(undefined)).toBe("")
    expect(extractBlockText({ content: 42 } as never)).toBe("")
    expect(extractBlockText({})).toBe("")
  })

  it("accepts a string content (some block types)", () => {
    expect(extractBlockText({ content: "raw string" })).toBe("raw string")
  })
})

describe("findNthBlockMatch", () => {
  const blocks = [
    { id: "a", type: "paragraph", content: [{ type: "text", text: "needle one" }] },
    { id: "b", type: "paragraph", content: [{ type: "text", text: "needle two and needle three" }] },
    {
      id: "c",
      type: "bulletListItem",
      content: [{ type: "text", text: "outer" }],
      children: [
        { id: "c-1", type: "paragraph", content: [{ type: "text", text: "nested needle four" }] },
      ],
    },
  ]

  it("first occurrence returns first block, local 0", () => {
    expect(findNthBlockMatch(blocks, "needle", 0)).toEqual({ block: blocks[0], localIndex: 0 })
  })

  it("counts across blocks in document order", () => {
    // Hit ordering: a/0, b/0, b/1, c-1/0
    expect(findNthBlockMatch(blocks, "needle", 1)).toMatchObject({ block: { id: "b" }, localIndex: 0 })
    expect(findNthBlockMatch(blocks, "needle", 2)).toMatchObject({ block: { id: "b" }, localIndex: 1 })
  })

  it("descends into children", () => {
    expect(findNthBlockMatch(blocks, "needle", 3)).toMatchObject({ block: { id: "c-1" }, localIndex: 0 })
  })

  it("case-insensitive", () => {
    const upper = [
      { id: "u", type: "paragraph", content: [{ type: "text", text: "Hello WORLD" }] },
    ]
    expect(findNthBlockMatch(upper, "world", 0)).toMatchObject({ block: { id: "u" }, localIndex: 0 })
  })

  it("out-of-range occurrence falls back to the last available match", () => {
    // Only 4 hits across the tree; asking for the 99th should land on the last.
    expect(findNthBlockMatch(blocks, "needle", 99)).toMatchObject({ block: { id: "c-1" }, localIndex: 0 })
  })

  it("returns null when no block contains the needle", () => {
    expect(findNthBlockMatch(blocks, "xyzzy", 0)).toBeNull()
  })

  it("returns null on empty needle", () => {
    expect(findNthBlockMatch(blocks, "", 0)).toBeNull()
  })

  it("tolerates null/undefined block lists", () => {
    expect(findNthBlockMatch(null, "hi", 0)).toBeNull()
    expect(findNthBlockMatch(undefined, "hi", 0)).toBeNull()
  })

  it("handles wikilink display text", () => {
    const withLink = [
      { id: "w", type: "paragraph", content: [
        { type: "text", text: "go to " },
        { type: "wikilink", props: { target: "Inertia", alias: "" } },
      ] },
    ]
    expect(findNthBlockMatch(withLink, "inertia", 0)).toMatchObject({ block: { id: "w" }, localIndex: 0 })
  })
})
