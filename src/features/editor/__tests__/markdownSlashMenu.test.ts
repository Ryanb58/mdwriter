import { describe, expect, it } from "vitest"
import { BlockNoteEditor } from "@blocknote/core"
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react"
import { editorSchema } from "../wikilinkInline"
import {
  MARKDOWN_SLASH_KEYS,
  filterMarkdownSlashMenuItems,
  getMarkdownSlashMenuItems,
} from "../markdownSlashMenu"

type RuntimeSlashItem = DefaultReactSuggestionItem & { key: string }

function createEditor() {
  return BlockNoteEditor.create({ schema: editorSchema })
}

function runtimeDefaultItems(editor: ReturnType<typeof createEditor>): RuntimeSlashItem[] {
  return getDefaultReactSlashMenuItems(editor).map((item) => {
    const key = (item as unknown as { key?: unknown }).key
    if (typeof key !== "string") {
      throw new Error("BlockNote slash item is missing its runtime key")
    }
    return item as RuntimeSlashItem
  })
}

describe("markdown slash menu", () => {
  it("keeps only the pinned Markdown-safe commands in their curated group order", () => {
    const items = getMarkdownSlashMenuItems(createEditor())

    expect(items.map((item) => item.key)).toEqual(MARKDOWN_SLASH_KEYS)
    expect(items.map((item) => item.group)).toEqual([
      "Text",
      "Text",
      "Text",
      "Text",
      "Text",
      "Text",
      "Lists",
      "Lists",
      "Lists",
      "Insert",
      "Insert",
      "Insert",
    ])
    expect([...new Set(items.map((item) => item.group))]).toEqual([
      "Text",
      "Lists",
      "Insert",
    ])
  })

  it("preserves BlockNote's titles, descriptions, aliases, badges, and icons", () => {
    const editor = createEditor()
    const defaults = new Map(runtimeDefaultItems(editor).map((item) => [item.key, item]))

    for (const item of getMarkdownSlashMenuItems(editor)) {
      const original = defaults.get(item.key)
      expect(original, `missing default item ${item.key}`).toBeDefined()
      expect(item.title).toBe(original?.title)
      expect(item.subtext).toBe(original?.subtext)
      expect(item.aliases).toEqual(original?.aliases)
      expect(item.badge).toBe(original?.badge)
      expect(item.icon).toEqual(original?.icon)
    }
  })

  it("matches aliases through BlockNote's public suggestion filter behavior", () => {
    const editor = createEditor()

    expect(filterMarkdownSlashMenuItems(editor, "checkbox").map((item) => item.key)).toEqual([
      "check_list",
    ])
    expect(filterMarkdownSlashMenuItems(editor, "blockquote").map((item) => item.key)).toEqual([
      "quote",
    ])
  })

  it("excludes non-Markdown media, emoji, toggles, and Heading 4-6", () => {
    const keys = getMarkdownSlashMenuItems(createEditor()).map((item) => item.key)

    for (const excludedKey of [
      "emoji",
      "video",
      "audio",
      "file",
      "toggle_list",
      "toggle_heading",
      "toggle_heading_2",
      "toggle_heading_3",
      "heading_4",
      "heading_5",
      "heading_6",
    ]) {
      expect(keys).not.toContain(excludedKey)
    }
  })

  it("inserts a rectangular 2-by-3 table with one Markdown header row", () => {
    const editor = createEditor()
    const tableItem = getMarkdownSlashMenuItems(editor).find((item) => item.key === "table")

    expect(tableItem).toBeDefined()
    tableItem?.onItemClick()

    const table = editor.document[0]
    expect(table.type).toBe("table")
    if (table.type !== "table") throw new Error("expected a table block")
    expect(table.content.headerRows).toBe(1)
    expect(table.content.headerCols).toBeUndefined()
    expect(table.content.rows).toHaveLength(2)
    expect(table.content.rows.every((row) => row.cells.length === 3)).toBe(true)
  })
})
