import { describe, expect, it } from "vitest"
import {
  buildBlockTextIndex,
  extractBlockText,
  findRenderedBlockMatches,
} from "../blockTextSearch"

describe("extractBlockText", () => {
  it("uses only the text people see for formatted links and wikilinks", () => {
    const block = {
      id: "links",
      type: "paragraph",
      content: [
        { type: "text", text: "Read ", styles: { bold: true } },
        {
          type: "link",
          href: "https://hidden.example/needle",
          content: [
            { type: "text", text: "the visible ", styles: { italic: true } },
            { type: "text", text: "label", styles: { code: true } },
          ],
        },
        { type: "text", text: " and " },
        { type: "wikilink", props: { target: "Hidden target", alias: "Visible note" } },
        { type: "text", text: "." },
      ],
    }

    expect(extractBlockText(block)).toBe("Read the visible label and Visible note.")
    expect(extractBlockText(block)).not.toContain("hidden.example")
    expect(extractBlockText(block)).not.toContain("Hidden target")
  })

  it("uses the wikilink target when there is no alias", () => {
    expect(extractBlockText({
      content: [{ type: "wikilink", props: { target: "Visible target", alias: "" } }],
    })).toBe("Visible target")
  })

  it("accepts string content and ignores unknown shapes", () => {
    expect(extractBlockText({ content: "raw string" })).toBe("raw string")
    expect(extractBlockText({ content: 42 } as never)).toBe("")
    expect(extractBlockText(null)).toBe("")
  })

  it("flattens visible table cells in rendered DOM order", () => {
    const table = {
      id: "table",
      type: "table",
      content: {
        type: "tableContent",
        headerRows: 1,
        rows: [
          {
            cells: [
              [{ type: "text", text: "Name", styles: { bold: true } }],
              [{
                type: "link",
                href: "https://hidden.example",
                content: [{ type: "text", text: "Visible link" }],
              }],
            ],
          },
          {
            cells: [
              [{ type: "wikilink", props: { target: "Hidden target", alias: "Alias" } }],
              [{ type: "text", text: "Value" }],
            ],
          },
        ],
      },
    }

    expect(extractBlockText(table)).toBe("NameVisible linkAliasValue")
    expect(findRenderedBlockMatches(
      buildBlockTextIndex("/vault/note.md", "rev", [table]).blocks,
      "linkalias",
    )).toEqual([{
      blockId: "table",
      text: "NameVisible linkAliasValue",
      from: 12,
      to: 21,
    }])
  })

  it("reads normalized BlockNote tableCell objects", () => {
    const table = {
      id: "normalized-table",
      type: "table",
      content: {
        type: "tableContent",
        rows: [{
          cells: [
            {
              type: "tableCell",
              props: { textAlignment: "left" },
              content: [{ type: "text", text: "First" }],
            },
            {
              type: "tableCell",
              props: { textAlignment: "left" },
              content: [{
                type: "link",
                href: "https://hidden.example",
                content: [{ type: "text", text: "Visible" }],
              }],
            },
          ],
        }],
      },
    }

    expect(extractBlockText(table)).toBe("FirstVisible")
  })
})

describe("buildBlockTextIndex", () => {
  it("flattens nested blocks in display order", () => {
    const index = buildBlockTextIndex("/vault/note.md", "note.md#4", [
      {
        id: "parent",
        type: "bulletListItem",
        content: [{ type: "text", text: "Parent" }],
        children: [
          {
            id: "child-a",
            type: "paragraph",
            content: [{ type: "text", text: "First child" }],
          },
          {
            id: "child-b",
            type: "paragraph",
            content: [{ type: "text", text: "Second child" }],
            children: [
              {
                id: "grandchild",
                type: "paragraph",
                content: [{ type: "text", text: "Grandchild" }],
              },
            ],
          },
        ],
      },
      {
        id: "last",
        type: "paragraph",
        content: [{ type: "text", text: "Last" }],
      },
    ])

    expect(index).toEqual({
      path: "/vault/note.md",
      docKey: "note.md#4",
      blocks: [
        { blockId: "parent", text: "Parent" },
        { blockId: "child-a", text: "First child" },
        { blockId: "child-b", text: "Second child" },
        { blockId: "grandchild", text: "Grandchild" },
        { blockId: "last", text: "Last" },
      ],
    })
  })

  it("skips blocks without stable ids but still indexes their children", () => {
    const index = buildBlockTextIndex("/vault/note.md", "rev", [
      {
        content: [{ type: "text", text: "No target" }],
        children: [{ id: "target", content: [{ type: "text", text: "Target" }] }],
      },
    ])

    expect(index.blocks).toEqual([{ blockId: "target", text: "Target" }])
  })
})

describe("findRenderedBlockMatches", () => {
  const blocks = [
    { blockId: "a", text: "Needle one" },
    { blockId: "b", text: "needle two and NEEDLE three" },
    { blockId: "nested", text: "nested needle four" },
  ]

  it("returns exact case-insensitive ranges in display order", () => {
    expect(findRenderedBlockMatches(blocks, "needle")).toEqual([
      { blockId: "a", text: "Needle one", from: 0, to: 6 },
      { blockId: "b", text: "needle two and NEEDLE three", from: 0, to: 6 },
      { blockId: "b", text: "needle two and NEEDLE three", from: 15, to: 21 },
      { blockId: "nested", text: "nested needle four", from: 7, to: 13 },
    ])
  })

  it("returns repeated non-overlapping matches within one block", () => {
    expect(findRenderedBlockMatches([{ blockId: "a", text: "aaaa" }], "aa")).toEqual([
      { blockId: "a", text: "aaaa", from: 0, to: 2 },
      { blockId: "a", text: "aaaa", from: 2, to: 4 },
    ])
  })

  it("does not match link destinations or aliased wikilink targets", () => {
    const index = buildBlockTextIndex("/vault/note.md", "rev", [{
      id: "links",
      content: [
        { type: "link", href: "https://hidden.example", content: [{ type: "text", text: "Visible" }] },
        { type: "text", text: " " },
        { type: "wikilink", props: { target: "Hidden", alias: "Alias" } },
      ],
    }])

    expect(findRenderedBlockMatches(index.blocks, "Visible")).toHaveLength(1)
    expect(findRenderedBlockMatches(index.blocks, "Alias")).toHaveLength(1)
    expect(findRenderedBlockMatches(index.blocks, "hidden")).toEqual([])
  })

  it("returns no matches for an empty query", () => {
    expect(findRenderedBlockMatches(blocks, "")).toEqual([])
  })
})
