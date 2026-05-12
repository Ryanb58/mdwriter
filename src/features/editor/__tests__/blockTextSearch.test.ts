import { describe, it, expect } from "vitest"
import { extractBlockText, findBlockContaining } from "../blockTextSearch"

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

describe("findBlockContaining", () => {
  const blocks = [
    { id: "a", type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
    {
      id: "b",
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        { type: "wikilink", props: { target: "Inertia", alias: "" } },
      ],
    },
    {
      id: "c",
      type: "bulletListItem",
      content: [{ type: "text", text: "outer" }],
      children: [
        {
          id: "c-1",
          type: "paragraph",
          content: [{ type: "text", text: "nested needle" }],
        },
      ],
    },
  ]

  it("case-insensitive substring match", () => {
    expect(findBlockContaining(blocks, "world")?.id).toBe("a")
    expect(findBlockContaining(blocks, "WORLD")?.id).toBe("a")
  })

  it("matches wikilink display text", () => {
    expect(findBlockContaining(blocks, "Inertia")?.id).toBe("b")
  })

  it("returns the first match in document order", () => {
    // Both "a" and "c-1" contain "e"; "a" comes first.
    expect(findBlockContaining(blocks, "e")?.id).toBe("a")
  })

  it("descends into children", () => {
    expect(findBlockContaining(blocks, "nested needle")?.id).toBe("c-1")
  })

  it("returns null on no match", () => {
    expect(findBlockContaining(blocks, "xyzzy")).toBeNull()
  })

  it("returns null on empty needle", () => {
    expect(findBlockContaining(blocks, "")).toBeNull()
  })

  it("tolerates null/undefined block lists", () => {
    expect(findBlockContaining(null, "hi")).toBeNull()
    expect(findBlockContaining(undefined, "hi")).toBeNull()
  })
})
