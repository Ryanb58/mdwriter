import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const uiState = vi.hoisted(() => ({
  selectedBlocks: [{ type: "paragraph", content: [] }] as Array<{
    type: string
    content?: unknown
  }>,
}))

vi.mock("@blocknote/react", async () => {
  const actual = await vi.importActual<typeof import("@blocknote/react")>(
    "@blocknote/react",
  )
  const React = await import("react")
  const { en } = await import("@blocknote/core/locales")

  return {
    ...actual,
    useBlockNoteEditor: () => ({ dictionary: en }),
    useDictionary: () => en,
    useSelectedBlocks: () => uiState.selectedBlocks,
    useComponentsContext: () => ({
      Generic: {
        Menu: {
          Item: ({ children }: any) => React.createElement("button", null, children),
        },
      },
    }),
    useExtensionState: () => ({
      rowIndex: 0,
      colIndex: 0,
      block: {
        content: {
          type: "tableContent",
          columnWidths: [undefined, undefined],
          headerRows: 1,
          rows: [{ cells: [[], []] }, { cells: [[], []] }],
        },
      },
    }),
    FormattingToolbarController: ({ formattingToolbar: Component }: any) =>
      Component ? React.createElement(Component) : null,
    FormattingToolbar: ({ children }: any) =>
      React.createElement(
        "div",
        { "data-testid": "formatting-toolbar" },
        children,
      ),
    BlockTypeSelect: ({ items }: any) =>
      React.createElement(
        "div",
        {
          "data-testid": "block-type-select",
          "data-items": JSON.stringify(
            items.map((item: any) => ({
              type: item.type,
              level: item.props?.level,
              name: item.name,
            })),
          ),
        },
      ),
    BasicTextStyleButton: ({ basicTextStyle }: any) =>
      React.createElement("button", null, basicTextStyle),
    CreateLinkButton: () => React.createElement("button", null, "link"),
    FileReplaceButton: () => React.createElement("button", null, "replace"),
    FileDeleteButton: () => React.createElement("button", null, "delete"),
    SideMenuController: ({ sideMenu: Component }: any) =>
      Component ? React.createElement(Component) : null,
    SideMenu: ({ children }: any) =>
      React.createElement("div", { "data-testid": "side-menu" }, children),
    AddBlockButton: () => React.createElement("button", null, "add"),
    DragHandleButton: ({ dragHandleMenu: Menu }: any) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement("button", null, "drag"),
        Menu ? React.createElement(Menu) : null,
      ),
    DragHandleMenu: ({ children }: any) =>
      React.createElement("div", { "data-testid": "drag-menu" }, children),
    RemoveBlockItem: ({ children }: any) =>
      React.createElement("button", null, children),
    TableHandlesController: ({ tableHandle: Handle, tableCellHandle: Cell }: any) =>
      React.createElement(
        "div",
        { "data-testid": "table-handles-controller" },
        React.createElement(Handle, { orientation: "row" }),
        React.createElement(Handle, { orientation: "column" }),
        React.createElement("div", { "data-testid": "table-cell-handle" }, React.createElement(Cell)),
      ),
    TableHandle: ({ orientation, tableHandleMenu: Menu }: any) =>
      React.createElement(
        "section",
        null,
        React.createElement("button", null, `drag ${orientation}`),
        React.createElement(Menu, { orientation }),
      ),
    TableHandleMenu: ({ children }: any) =>
      React.createElement("div", { "data-testid": "table-handle-menu" }, children),
    AddButton: ({ orientation, side }: any) =>
      React.createElement("button", null, `add ${orientation} ${side}`),
  }
})

import {
  MarkdownFormattingToolbar,
  MarkdownSideMenu,
  classifyFormattingSelection,
  isUnsupportedMarkdownShortcut,
} from "../MarkdownEditorUi"
import { MarkdownTableHandles } from "../markdownTables"

afterEach(cleanup)

beforeEach(() => {
  uiState.selectedBlocks = [{ type: "paragraph", content: [] }]
})

describe("classifyFormattingSelection", () => {
  it.each([
    "paragraph",
    "heading",
    "quote",
    "codeBlock",
    "bulletListItem",
    "numberedListItem",
    "checkListItem",
  ])("classifies a %s selection as inline", (type) => {
    expect(classifyFormattingSelection([{ type, content: [] }])).toBe("inline")
  })

  it("classifies a mixed selection of Markdown text blocks as inline", () => {
    expect(
      classifyFormattingSelection([
        { type: "paragraph", content: [] },
        { type: "quote", content: [] },
        { type: "codeBlock", content: [] },
      ]),
    ).toBe("inline")
  })

  it("classifies one image as image", () => {
    expect(classifyFormattingSelection([{ type: "image" }])).toBe("image")
  })

  it.each(["audio", "video", "file"])(
    "classifies one %s block as file",
    (type) => {
      expect(classifyFormattingSelection([{ type }])).toBe("file")
    },
  )

  it.each([
    [[{ type: "divider" }]],
    [[{ type: "table", content: {} }]],
    [[{ type: "paragraph", content: [] }, { type: "image" }]],
    [[]],
  ])("classifies unsupported or mixed selections as none", (blocks) => {
    expect(classifyFormattingSelection(blocks)).toBe("none")
  })
})

describe("isUnsupportedMarkdownShortcut", () => {
  function keyEvent(
    overrides: Partial<
      Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey" | "code" | "key">
    >,
  ) {
    return {
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      code: "",
      key: "",
      ...overrides,
    }
  }

  it.each([
    { metaKey: true, code: "KeyU", key: "u" },
    { ctrlKey: true, code: "KeyU", key: "u" },
    { metaKey: true, shiftKey: true, code: "Digit6", key: "^" },
    { ctrlKey: true, shiftKey: true, code: "Digit6", key: "^" },
  ])("blocks the unsupported shortcut %#", (event) => {
    expect(isUnsupportedMarkdownShortcut(keyEvent(event))).toBe(true)
  })

  it.each([
    { code: "KeyU", key: "u" },
    { metaKey: true, shiftKey: true, code: "Digit7", key: "&" },
    { ctrlKey: true, shiftKey: true, code: "Digit8", key: "*" },
    { metaKey: true, shiftKey: true, code: "Digit9", key: "(" },
  ])("leaves the supported shortcut %# available", (event) => {
    expect(isUnsupportedMarkdownShortcut(keyEvent(event))).toBe(false)
  })
})

describe("MarkdownFormattingToolbar", () => {
  it("orders only Markdown-safe block types", () => {
    render(<MarkdownFormattingToolbar />)

    const select = screen.getByTestId("block-type-select")
    const items = JSON.parse(select.getAttribute("data-items") ?? "[]")
    expect(
      items.map((item: { type: string; level?: number }) =>
        item.type === "heading" ? `H${item.level}` : item.type,
      ),
    ).toEqual([
      "paragraph",
      "H1",
      "H2",
      "H3",
      "quote",
      "codeBlock",
      "bulletListItem",
      "numberedListItem",
      "checkListItem",
    ])
    expect(items.every((item: { name?: string }) => item.name)).toBe(true)
  })

  it("shows only block type, Bold, Italic, Strike, Code, and Link for inline selections", () => {
    render(<MarkdownFormattingToolbar />)

    const toolbar = screen.getByTestId("formatting-toolbar")
    expect(within(toolbar).getByTestId("block-type-select")).toBeInTheDocument()
    expect(
      within(toolbar)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["bold", "italic", "strike", "code", "link"])
  })

  it("shows only Replace and Delete for an image", () => {
    uiState.selectedBlocks = [{ type: "image" }]
    render(<MarkdownFormattingToolbar />)

    expect(
      within(screen.getByTestId("formatting-toolbar"))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["replace", "delete"])
  })

  it.each(["audio", "video", "file"])(
    "shows only Delete for a %s block",
    (type) => {
      uiState.selectedBlocks = [{ type }]
      render(<MarkdownFormattingToolbar />)

      expect(
        within(screen.getByTestId("formatting-toolbar"))
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual(["delete"])
    },
  )

  it("does not mount a toolbar shell for an unsupported selection", () => {
    uiState.selectedBlocks = [{ type: "table", content: {} }]
    render(<MarkdownFormattingToolbar />)

    expect(screen.queryByTestId("formatting-toolbar")).not.toBeInTheDocument()
  })
})

describe("MarkdownSideMenu", () => {
  it("preserves Add and Drag with Delete as the only menu command", () => {
    render(<MarkdownSideMenu />)

    const sideMenu = screen.getByTestId("side-menu")
    expect(within(sideMenu).getByRole("button", { name: "add" })).toBeInTheDocument()
    expect(within(sideMenu).getByRole("button", { name: "drag" })).toBeInTheDocument()
    const dragMenu = within(sideMenu).getByTestId("drag-menu")
    expect(within(dragMenu).getAllByRole("button").map((item) => item.textContent)).toEqual([
      "Delete",
    ])
    expect(within(sideMenu).queryByText(/colors/i)).not.toBeInTheDocument()
  })
})

describe("MarkdownTableHandles composition", () => {
  it("retains drag, add, and controller extension behavior without unsafe cell controls", () => {
    render(<MarkdownTableHandles />)

    const controller = screen.getByTestId("table-handles-controller")
    expect(within(controller).getByRole("button", { name: "drag row" })).toBeInTheDocument()
    expect(
      within(controller).getByRole("button", { name: "drag column" }),
    ).toBeInTheDocument()
    expect(
      within(controller)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      "drag row",
      "Delete row",
      "add row above",
      "add row below",
      "drag column",
      "Delete column",
      "add column left",
      "add column right",
    ])
    expect(within(controller).getByTestId("table-cell-handle")).toBeEmptyDOMElement()
    expect(within(controller).queryByText(/colors|header|merge|split/i)).not.toBeInTheDocument()
  })
})
