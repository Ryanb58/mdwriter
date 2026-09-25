import { EditorState } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { outlineBlockIds, parseOutline, rawHeadingPosition, sectionAt } from "../documentOutline"

describe("canonical Markdown outline", () => {
  it("includes ATX/setext headings with readable inline text and real ancestry", () => {
    const headings = parseOutline("# **One** &amp; `code`\n\n### [Child](url)\n\n## Sibling ###\n\nTitle\n=====\n\n###### Deep\n\n#\n")
    expect(headings.map(({ title, level, indent }) => ({ title, level, indent }))).toEqual([
      { title: "One & code", level: 1, indent: 0 },
      { title: "Child", level: 3, indent: 1 },
      { title: "Sibling", level: 2, indent: 1 },
      { title: "Title", level: 1, indent: 0 },
      { title: "Deep", level: 6, indent: 1 },
      { title: "Untitled heading", level: 1, indent: 0 },
    ])
  })

  it("ignores fenced/indented code, HTML blocks, escaped hashes and thematic breaks", () => {
    const text = "```md\n# fenced\n```\n\n~~~\n## also code\n~~~\n\n    # indented\n\n<!--\n# comment\n-->\n\n<div>\n# html\n</div>\n\n\\# escaped\n\n---\n\n# Actual\n"
    expect(parseOutline(text).map((h) => h.title)).toEqual(["Actual"])
  })

  it.each(["\n", "\r\n"])("excludes YAML, preserving exact source coordinates with %j", (eol) => {
    const text = ["---", "# YAML comment", "title: 🪴", "description: |", "  # Not a heading", "---", "", "# Real", "", "## Again"].join(eol)
    const headings = parseOutline(text)
    expect(headings.map((h) => [h.title, h.line, h.from])).toEqual([
      ["Real", 8, text.indexOf("# Real")], ["Again", 10, text.indexOf("## Again")],
    ])
    const doc = EditorState.create({ doc: text }).doc
    expect(rawHeadingPosition(headings[1], doc)).toBe(doc.line(10).from)
  })

  it("handles empty YAML and BOM/CRLF YAML, but not later thematic breaks as YAML", () => {
    expect(parseOutline("---\n---\n# Yes").map((h) => h.title)).toEqual(["Yes"])
    expect(parseOutline("\uFEFF---\r\n# no\r\n...\r\n# Yes").map((h) => h.title)).toEqual(["Yes"])
    expect(parseOutline("Intro\n\n---\n\n# Yes\n\n---\n").map((h) => h.title)).toEqual(["Yes"])
  })

  it("includes nested headings and distinguishes duplicates by source position", () => {
    const text = "> ## Same\n\n- item\n\n  ### Same\n\n## Same"
    const headings = parseOutline(text)
    expect(headings.map((h) => h.title)).toEqual(["Same", "Same", "Same"])
    expect(new Set(headings.map((h) => h.from)).size).toBe(3)
    const doc = EditorState.create({ doc: text }).doc
    for (const heading of headings) expect(rawHeadingPosition(heading, doc)).toBe(heading.from)
  })

  it("does not invent headings from GFM tables or unclosed code fences", () => {
    expect(parseOutline("| title |\n| --- |\n| # cell |\n\n```\n# unfinished")).toEqual([])
  })

  it("uses safe cursor/scroll boundaries and rejects stale raw positions", () => {
    expect(sectionAt([], 10)).toBe(-1)
    expect(sectionAt([10, 30, 50], 0)).toBe(-1)
    expect(sectionAt([10, 30, 50], 30)).toBe(1)
    expect(sectionAt([10, 30, 50], 49)).toBe(1)
    expect(sectionAt([10, 30, 50], 1000)).toBe(2)
    const heading = parseOutline("\n\n# Heading")[0]
    expect(rawHeadingPosition(heading, EditorState.create({ doc: "" }).doc)).toBeNull()
  })

  it("maps duplicate and nested BlockNote headings in document order, rejecting stale structures", () => {
    const headings = parseOutline("# Same\n\n## Same\n\n# Same")
    const blocks = [
      { id: "a", type: "heading", props: { level: 1 }, children: [{ id: "b", type: "heading", props: { level: 2 } }] },
      { id: "p", type: "paragraph" },
      { id: "c", type: "heading", props: { level: 1 } },
    ]
    expect(outlineBlockIds(headings, blocks)).toEqual(["a", "b", "c"])
    expect(outlineBlockIds(headings, blocks.slice(0, 1))).toEqual([])
    expect(outlineBlockIds(parseOutline("# Same\n\n### Same\n\n# Same"), blocks)).toEqual([])
  })
})
