import { BlockNoteEditor } from "@blocknote/core"
import { getDefaultReactSlashMenuItems } from "@blocknote/react"
import { describe, expect, it } from "vitest"
import { editorSchema } from "../wikilinkInline"

const fixtures = [
  {
    name: "headings 1-3 and paragraphs",
    markdown: [
      "# Heading one",
      "",
      "## Heading two",
      "",
      "### Heading three",
      "",
      "A plain paragraph.",
    ].join("\n"),
  },
  {
    name: "bullet, numbered, and checklist items",
    markdown: [
      "- Bullet one",
      "- Bullet two",
      "",
      "1. Number one",
      "2. Number two",
      "",
      "- [x] Complete",
      "- [ ] Incomplete",
    ].join("\n"),
  },
  {
    name: "a fenced code block with a language token",
    markdown: ["```typescript", "const answer = 42", "```"].join("\n"),
  },
  {
    name: "a single-paragraph quote and divider",
    markdown: ["> A quoted paragraph.", "", "---"].join("\n"),
  },
  {
    name: "links and an uncaptioned named image",
    markdown: [
      "A [named link](https://example.com/docs).",
      "",
      "![Diagram alt](https://example.com/diagram.png)",
    ].join("\n"),
  },
  {
    name: "inline styles and hard breaks",
    markdown:
      "**bold** *italic* ~~strikethrough~~ `inline code` before break  \nafter break",
  },
] as const

function createEditor() {
  return BlockNoteEditor.create({ schema: editorSchema })
}

function withoutGeneratedIds(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, nestedValue) =>
      key === "id" ? undefined : nestedValue,
    ),
  )
}

async function assertStableMarkdown(markdown: string) {
  const editor = createEditor()
  const firstImport = await editor.tryParseMarkdownToBlocks(markdown)

  editor.replaceBlocks(editor.document, firstImport)
  const firstCanonicalMarkdown = await editor.blocksToMarkdownLossy()
  const secondImport = await editor.tryParseMarkdownToBlocks(firstCanonicalMarkdown)

  expect(withoutGeneratedIds(secondImport)).toEqual(withoutGeneratedIds(firstImport))

  editor.replaceBlocks(editor.document, secondImport)
  const secondCanonicalMarkdown = await editor.blocksToMarkdownLossy()
  const thirdImport = await editor.tryParseMarkdownToBlocks(secondCanonicalMarkdown)

  expect(secondCanonicalMarkdown).toBe(firstCanonicalMarkdown)
  expect(withoutGeneratedIds(thirdImport)).toEqual(withoutGeneratedIds(secondImport))

  return { firstImport, secondImport }
}

type TableBlock = {
  type: "table"
  content: {
    headerRows?: number
    rows: Array<{ cells: unknown[] }>
  }
}

function findTable(blocks: readonly unknown[]): TableBlock {
  const table = blocks.find(
    (block) => (block as { type?: string }).type === "table",
  )
  expect(table).toBeDefined()
  return table as TableBlock
}

describe("BlockNote 0.50 Markdown contract", () => {
  describe("stable supported subset", () => {
    it.each(fixtures)("round-trips $name semantically", async ({ markdown }) => {
      await assertStableMarkdown(markdown)
    })

    it("round-trips a rectangular GFM table with one header row", async () => {
      const markdown = [
        "| Name | Value |",
        "| --- | --- |",
        "| Alpha | One |",
        "| Beta | Two |",
      ].join("\n")

      const { firstImport, secondImport } = await assertStableMarkdown(markdown)
      const firstTable = findTable(firstImport)
      const secondTable = findTable(secondImport)

      expect(firstTable.content.headerRows).toBe(1)
      expect(secondTable.content.headerRows).toBe(1)
      expect(firstTable.content.rows).toHaveLength(3)
      expect(firstTable.content.rows[0].cells).toHaveLength(2)
      expect(secondTable.content.rows).toHaveLength(firstTable.content.rows.length)
      expect(secondTable.content.rows.map((row) => row.cells.length)).toEqual(
        firstTable.content.rows.map((row) => row.cells.length),
      )
    })
  })

  describe("known loss boundaries", () => {
    it("does not treat a programmatic headerless table as round-trip safe", async () => {
      const editor = createEditor()
      editor.replaceBlocks(editor.document, [
        {
          type: "table",
          content: {
            type: "tableContent",
            headerRows: 0,
            rows: [
              { cells: ["Alpha", "One"] },
              { cells: ["Beta", "Two"] },
            ],
          },
        },
      ])
      const originalShape = withoutGeneratedIds(editor.document)

      const markdown = await editor.blocksToMarkdownLossy()
      const reimported = await editor.tryParseMarkdownToBlocks(markdown)
      const reimportedTable = findTable(reimported)

      expect(withoutGeneratedIds(reimported)).not.toEqual(originalShape)
      expect(reimportedTable.content.headerRows).toBe(1)
    })

    it("loses image captions and reparses the caption as stray paragraph text", async () => {
      const editor = createEditor()
      editor.replaceBlocks(editor.document, [
        {
          type: "image",
          props: {
            url: "https://example.com/diagram.png",
            name: "Diagram alt",
            caption: "Caption that cannot round-trip",
          },
        },
      ])

      const markdown = await editor.blocksToMarkdownLossy()
      const reimported = await editor.tryParseMarkdownToBlocks(markdown)
      const image = reimported.find((block) => block.type === "image")
      const strayParagraph = reimported.find(
        (block) =>
          block.type === "paragraph" &&
          JSON.stringify(block.content).includes("Caption that cannot round-trip"),
      )

      expect(image).toBeDefined()
      expect((image as { props: { caption: string } }).props.caption).toBe("")
      expect(strayParagraph).toBeDefined()
    })

    it("exposes string keys on every runtime React slash-menu item", () => {
      const items = getDefaultReactSlashMenuItems(createEditor())

      expect(items.length).toBeGreaterThan(0)
      expect(
        items.every(
          (item) =>
            typeof (item as unknown as { key?: unknown }).key === "string",
        ),
      ).toBe(true)
    })
  })
})
