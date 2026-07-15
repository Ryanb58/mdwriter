import { describe, expect, it } from "vitest"
import type {
  PartialBlock,
  PartialTableContent,
  TableContent,
} from "@blocknote/core"
import {
  createMarkdownTableBlock,
  deleteMarkdownTableAxis,
} from "../markdownTables"

function tableContent(rows: string[][]): TableContent<any, any> {
  const columns = rows[0]?.length ?? 0
  return {
    type: "tableContent",
    columnWidths: Array.from({ length: columns }, (_, index) => (index + 1) * 100),
    headerRows: 1,
    rows: rows.map((row) => ({
      cells: row.map((text) => [{ type: "text", text, styles: {} }]),
    })),
  }
}

function cellText(cell: unknown): string {
  if (!Array.isArray(cell)) throw new Error("expected a simple table cell")
  return cell
    .map((item) =>
      typeof item === "object" && item && "text" in item ? String(item.text) : "",
    )
    .join("")
}

function rowTexts(content: TableContent<any, any>): string[][] {
  return content.rows.map((row) => row.cells.map(cellText))
}

function blockTableContent(block: PartialBlock): PartialTableContent<any, any> {
  const content = block.content
  if (
    typeof content !== "object" ||
    content === null ||
    Array.isArray(content) ||
    content.type !== "tableContent"
  ) {
    throw new Error("expected table content")
  }
  return content
}

describe("Markdown table factory", () => {
  it("creates a rectangular table with one header row and no header columns", () => {
    const block = createMarkdownTableBlock()

    expect(block.type).toBe("table")
    const content = blockTableContent(block)
    expect(content.headerRows).toBe(1)
    expect(content.headerCols).toBeUndefined()
    expect(content.rows).toHaveLength(2)
    expect(content.rows.every((row) => row.cells.length === 3)).toBe(true)
    expect(content.columnWidths).toEqual([undefined, undefined, undefined])
  })
})

describe("deleteMarkdownTableAxis", () => {
  it("promotes the next row when deleting row zero", () => {
    const result = deleteMarkdownTableAxis(
      tableContent([
        ["A1", "A2"],
        ["B1", "B2"],
        ["C1", "C2"],
      ]),
      "row",
      0,
    )

    expect(result.kind).toBe("update")
    if (result.kind !== "update") throw new Error("expected table update")
    expect(result.content.headerRows).toBe(1)
    expect(rowTexts(result.content)).toEqual([
      ["B1", "B2"],
      ["C1", "C2"],
    ])
  })

  it("deletes a middle row without changing any other cells", () => {
    const result = deleteMarkdownTableAxis(
      tableContent([
        ["A1", "A2"],
        ["B1", "B2"],
        ["C1", "C2"],
      ]),
      "row",
      1,
    )

    expect(result.kind).toBe("update")
    if (result.kind !== "update") throw new Error("expected table update")
    expect(rowTexts(result.content)).toEqual([
      ["A1", "A2"],
      ["C1", "C2"],
    ])
    expect(result.content.headerRows).toBe(1)
  })

  it("removes the table when deleting its only row", () => {
    expect(deleteMarkdownTableAxis(tableContent([["A1", "A2"]]), "row", 0)).toEqual({
      kind: "remove-table",
    })
  })

  it("deletes a column from every row and keeps the table rectangular", () => {
    const result = deleteMarkdownTableAxis(
      tableContent([
        ["A1", "A2", "A3"],
        ["B1", "B2", "B3"],
      ]),
      "column",
      1,
    )

    expect(result.kind).toBe("update")
    if (result.kind !== "update") throw new Error("expected table update")
    expect(rowTexts(result.content)).toEqual([
      ["A1", "A3"],
      ["B1", "B3"],
    ])
    expect(result.content.rows.every((row) => row.cells.length === 2)).toBe(true)
    expect(result.content.columnWidths).toEqual([100, 300])
  })

  it("removes the table when deleting its final column", () => {
    expect(deleteMarkdownTableAxis(tableContent([["A1"], ["B1"]]), "column", 0)).toEqual({
      kind: "remove-table",
    })
  })

  it.each([
    ["row", -1],
    ["row", 3],
    ["column", -1],
    ["column", 2],
  ] as const)("returns noop for an out-of-range %s index %i", (orientation, index) => {
    expect(
      deleteMarkdownTableAxis(
        tableContent([
          ["A1", "A2"],
          ["B1", "B2"],
        ]),
        orientation,
        index,
      ),
    ).toEqual({ kind: "noop" })
  })
})
