import type { PartialBlock, TableContent } from "@blocknote/core"
import { TableHandlesExtension } from "@blocknote/core/extensions"
import {
  AddButton,
  TableHandle,
  TableHandleMenu,
  TableHandlesController,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtensionState,
  type TableHandleProps,
} from "@blocknote/react"

export type TableDeleteResult =
  | { kind: "update"; content: TableContent<any, any> }
  | { kind: "remove-table" }
  | { kind: "noop" }

export function createMarkdownTableBlock(rows = 2, columns = 3): PartialBlock {
  return {
    type: "table",
    content: {
      type: "tableContent",
      columnWidths: Array.from({ length: columns }, () => undefined),
      headerRows: 1,
      rows: Array.from({ length: rows }, () => ({
        cells: Array.from({ length: columns }, () => []),
      })),
    },
  }
}

export function deleteMarkdownTableAxis(
  content: TableContent<any, any>,
  orientation: "row" | "column",
  index: number,
): TableDeleteResult {
  if (!Number.isInteger(index) || index < 0) return { kind: "noop" }

  if (orientation === "row") {
    if (index >= content.rows.length) return { kind: "noop" }
    if (content.rows.length === 1) return { kind: "remove-table" }

    return {
      kind: "update",
      content: {
        ...content,
        headerRows: 1,
        rows: content.rows.filter((_, rowIndex) => rowIndex !== index),
      },
    }
  }

  const columnCount = content.rows[0]?.cells.length ?? 0
  if (index >= columnCount) return { kind: "noop" }
  if (columnCount === 1) return { kind: "remove-table" }

  return {
    kind: "update",
    content: {
      ...content,
      columnWidths: content.columnWidths.filter(
        (_, columnIndex) => columnIndex !== index,
      ),
      rows: content.rows.map((row) => ({
        ...row,
        cells: row.cells.filter(
          (_, columnIndex) => columnIndex !== index,
        ) as typeof row.cells,
      })),
    },
  }
}

function MarkdownTableDeleteButton({
  orientation,
}: {
  orientation: "row" | "column"
}) {
  const editor = useBlockNoteEditor<any, any, any>()
  const Components = useComponentsContext()
  const dictionary = useDictionary()
  const state = useExtensionState(TableHandlesExtension)
  const index = orientation === "row" ? state?.rowIndex : state?.colIndex

  if (!Components || !state || index === undefined) return null

  return (
    <Components.Generic.Menu.Item
      onClick={() => {
        const result = deleteMarkdownTableAxis(state.block.content, orientation, index)
        if (result.kind === "update") {
          editor.updateBlock(state.block, {
            type: "table",
            content: result.content,
          })
        } else if (result.kind === "remove-table") {
          editor.removeBlocks([state.block])
        }
      }}
    >
      {orientation === "row"
        ? dictionary.table_handle.delete_row_menuitem
        : dictionary.table_handle.delete_column_menuitem}
    </Components.Generic.Menu.Item>
  )
}

function MarkdownTableHandleMenu({
  orientation,
}: {
  orientation?: "row" | "column"
}) {
  if (!orientation) return null

  return (
    <TableHandleMenu orientation={orientation}>
      <MarkdownTableDeleteButton orientation={orientation} />
      {orientation === "row" ? (
        <>
          <AddButton orientation="row" side="above" />
          <AddButton orientation="row" side="below" />
        </>
      ) : (
        <>
          <AddButton orientation="column" side="left" />
          <AddButton orientation="column" side="right" />
        </>
      )}
    </TableHandleMenu>
  )
}

function MarkdownTableHandle(props: TableHandleProps) {
  return <TableHandle {...props} tableHandleMenu={MarkdownTableHandleMenu} />
}

function EmptyTableCellHandle() {
  return null
}

export function MarkdownTableHandles() {
  return (
    <TableHandlesController
      tableHandle={MarkdownTableHandle}
      tableCellHandle={EmptyTableCellHandle}
    />
  )
}
