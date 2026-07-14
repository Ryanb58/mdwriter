import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => {
  const storeState = {
    pendingScroll: null as null | {
      kind: "find-block" | "vault-reveal"
      path: string
      blockId?: string
      from?: number
      to?: number
      requestId?: number
      line?: number
      matchText?: string
      occurrence?: number
    },
    openDoc: null as null | { path: string },
    blockTextIndex: null as null | { path: string; docKey: string; blocks: unknown[] },
    pendingCursorAtEnd: null,
    setPendingScroll: vi.fn(),
    setBlockTextIndex: vi.fn(),
    setPendingCursorAtEnd: vi.fn(),
    setEditorSelection: vi.fn(),
    setHeadingCommittedPath: vi.fn(),
  }
  const editor = {
    document: [{ id: "empty", type: "paragraph", content: [] }] as Array<{
      id: string
      type: string
      content: unknown[]
      children?: Array<{ id: string; type: string; content: unknown[] }>
    }>,
    tryParseMarkdownToBlocks: vi.fn(),
    replaceBlocks: vi.fn(),
    blocksToMarkdownLossy: vi.fn(),
    isFocused: vi.fn(() => true),
    setTextCursorPosition: vi.fn(),
    focus: vi.fn(),
    onSelectionChange: vi.fn(() => vi.fn()),
    getSelectedText: vi.fn(() => ""),
  }
  const findCleanup = vi.fn()

  return {
    editor,
    onChange: null as null | (() => Promise<void>),
    storeState,
    findCleanup,
    highlightBlockFindTarget: vi.fn(() => ({
      exact: true,
      cleanup: findCleanup,
    })),
  }
})

vi.mock("@blocknote/react", () => ({
  useCreateBlockNote: () => harness.editor,
  SuggestionMenuController: () => null,
}))

vi.mock("@blocknote/mantine", async () => {
  const React = await import("react")
  return {
    BlockNoteView: ({ onChange }: { onChange: () => Promise<void> }) => {
      harness.onChange = onChange
      return React.createElement("div", { "data-id": "title" }, "Title")
    },
  }
})

vi.mock("../../settings/useTheme", () => ({
  useResolvedTheme: () => "light",
}))

vi.mock("../../../lib/store", () => {
  const useStore = Object.assign(
    (selector: (state: typeof harness.storeState) => unknown) =>
      selector(harness.storeState),
    { getState: () => harness.storeState },
  )
  return { useStore }
})

vi.mock("../../../lib/vaultNotes", () => ({
  useVaultNotes: () => [],
}))

vi.mock("../wikilinkInline", () => ({
  editorSchema: {},
  setWikilinkNotes: vi.fn(),
}))

vi.mock("../wikilinkRoundtrip", () => ({
  hydrateWikilinkBlocks: (blocks: unknown) => blocks,
  preprocessWikilinks: (markdown: string) => markdown,
  postprocessWikilinks: (markdown: string) => markdown,
}))

vi.mock("../useLinkActivation", () => ({
  useLinkActivation: vi.fn(),
}))

vi.mock("../MarkdownEditorUi", () => ({
  MarkdownFormattingToolbar: () => null,
  MarkdownSideMenu: () => null,
  isUnsupportedMarkdownShortcut: () => false,
}))

vi.mock("../markdownSlashMenu", () => ({
  filterMarkdownSlashMenuItems: () => [],
}))

vi.mock("../markdownTables", () => ({
  MarkdownTableHandles: () => null,
}))

vi.mock("../blockFindHighlight", () => ({
  highlightBlockFindTarget: harness.highlightBlockFindTarget,
}))

import { BlockEditor } from "../BlockEditor"

describe("BlockEditor initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.onChange = null
    harness.storeState.pendingScroll = null
    harness.storeState.openDoc = { path: "/vault/title.md" }
    harness.storeState.blockTextIndex = null
    harness.storeState.setBlockTextIndex.mockImplementation((index) => {
      harness.storeState.blockTextIndex = index
    })
    harness.editor.document = [{ id: "empty", type: "paragraph", content: [] }]
    harness.editor.tryParseMarkdownToBlocks.mockResolvedValue([
      { id: "title", type: "heading", content: [{ type: "text", text: "Title" }] },
    ])
    harness.editor.blocksToMarkdownLossy.mockResolvedValue("# Title\n")
    harness.editor.isFocused.mockReturnValue(true)
    harness.editor.replaceBlocks.mockImplementation((_oldBlocks, newBlocks) => {
      harness.editor.document = newBlocks
      void harness.onChange?.()
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("does not export hydration changes but emits the next user change", async () => {
    const onChangeMarkdown = vi.fn()

    render(
      <BlockEditor
        initialMarkdown="# Title"
        onChangeMarkdown={onChangeMarkdown}
        docKey="notes/title.md:1"
      />,
    )

    await waitFor(() => {
      expect(harness.editor.replaceBlocks).toHaveBeenCalledTimes(1)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(onChangeMarkdown).not.toHaveBeenCalled()
    expect(harness.editor.blocksToMarkdownLossy).not.toHaveBeenCalled()

    harness.editor.blocksToMarkdownLossy.mockResolvedValue("# Changed\n")
    await act(async () => {
      await harness.onChange?.()
    })

    expect(onChangeMarkdown).toHaveBeenCalledTimes(1)
    expect(onChangeMarkdown).toHaveBeenCalledWith("# Changed\n")
  })

  it("restores focus on the next animation frame after mounting", async () => {
    let focusFrame: FrameRequestCallback | null = null
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      focusFrame = callback
      return 1
    }))
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    harness.editor.isFocused.mockReturnValue(false)

    render(
      <BlockEditor
        initialMarkdown="# Title"
        onChangeMarkdown={vi.fn()}
        docKey="notes/title.md:1"
      />,
    )

    await waitFor(() => {
      expect(harness.editor.setTextCursorPosition).toHaveBeenCalledTimes(1)
    })
    expect(harness.editor.focus).not.toHaveBeenCalled()
    expect(focusFrame).not.toBeNull()

    act(() => focusFrame?.(0))

    expect(harness.editor.focus).toHaveBeenCalledTimes(1)
  })

  it("does not take cursor or focus from an open Find bar during hydration", async () => {
    harness.editor.isFocused.mockReturnValue(false)
    const find = render(<div data-find-bar><input aria-label="Find in note" /></div>)
    const input = find.getByRole("textbox", { name: "Find in note" })
    input.focus()

    render(
      <BlockEditor
        initialMarkdown="# Title"
        onChangeMarkdown={vi.fn()}
        docKey="notes/title.md:1"
      />,
    )
    await waitFor(() => {
      expect(harness.editor.replaceBlocks).toHaveBeenCalledTimes(1)
    })

    expect(input).toHaveFocus()
    expect(harness.editor.setTextCursorPosition).not.toHaveBeenCalled()
    expect(harness.editor.focus).not.toHaveBeenCalled()
  })

  it("does not restore editor focus if Find receives focus before the frame", async () => {
    let focusFrame: FrameRequestCallback | null = null
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      focusFrame = callback
      return 1
    }))
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    harness.editor.isFocused.mockReturnValue(false)

    render(
      <BlockEditor
        initialMarkdown="# Title"
        onChangeMarkdown={vi.fn()}
        docKey="notes/title.md:1"
      />,
    )
    await waitFor(() => {
      expect(harness.editor.setTextCursorPosition).toHaveBeenCalledTimes(1)
    })
    expect(focusFrame).not.toBeNull()

    const find = render(<div data-find-bar><input aria-label="Find in note" /></div>)
    const input = find.getByRole("textbox", { name: "Find in note" })
    input.focus()
    act(() => focusFrame?.(0))

    expect(input).toHaveFocus()
    expect(harness.editor.focus).not.toHaveBeenCalled()
  })

  it("publishes rendered block text after hydration and user changes", async () => {
    harness.editor.tryParseMarkdownToBlocks.mockResolvedValue([
      {
        id: "title",
        type: "paragraph",
        content: [
          { type: "text", text: "Visible " },
          { type: "wikilink", props: { target: "Hidden", alias: "Alias" } },
        ],
        children: [{
          id: "child",
          type: "paragraph",
          content: [{ type: "text", text: "Nested" }],
        }],
      },
    ])
    const view = render(
      <BlockEditor
        initialMarkdown="Visible [[Hidden|Alias]]"
        onChangeMarkdown={vi.fn()}
        docKey="/vault/title.md#2"
      />,
    )

    await waitFor(() => {
      expect(harness.storeState.setBlockTextIndex).toHaveBeenCalledWith({
        path: "/vault/title.md",
        docKey: "/vault/title.md#2",
        blocks: [
          { blockId: "title", text: "Visible Alias" },
          { blockId: "child", text: "Nested" },
        ],
      })
    })

    harness.editor.document = [{
      id: "title",
      type: "paragraph",
      content: [{ type: "text", text: "Changed" }],
    }]
    harness.editor.blocksToMarkdownLossy.mockResolvedValue("Changed")
    await act(async () => harness.onChange?.())
    expect(harness.storeState.setBlockTextIndex).toHaveBeenLastCalledWith({
      path: "/vault/title.md",
      docKey: "/vault/title.md#2",
      blocks: [{ blockId: "title", text: "Changed" }],
    })

    view.unmount()
    expect(harness.storeState.setBlockTextIndex).toHaveBeenLastCalledWith(null)
  })

  it("shows an exact block target without moving or consuming the editor selection", async () => {
    harness.storeState.pendingScroll = {
      kind: "find-block",
      path: "/vault/title.md",
      blockId: "title",
      from: 1,
      to: 4,
      requestId: 7,
    }

    render(
      <BlockEditor
        initialMarkdown="# Title"
        onChangeMarkdown={vi.fn()}
        docKey="/vault/title.md#2"
      />,
    )

    await waitFor(() => {
      expect(harness.highlightBlockFindTarget).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        { blockId: "title", from: 1, to: 4 },
      )
    })
    expect(harness.editor.setTextCursorPosition).not.toHaveBeenCalled()
    expect(harness.storeState.setPendingScroll).not.toHaveBeenCalled()
  })

  it("clears the previous overlay immediately when the next block is missing", async () => {
    harness.storeState.pendingScroll = {
      kind: "find-block",
      path: "/vault/title.md",
      blockId: "title",
      from: 1,
      to: 4,
      requestId: 7,
    }
    const view = render(
      <BlockEditor
        initialMarkdown="# Title"
        onChangeMarkdown={vi.fn()}
        docKey="/vault/title.md#2"
      />,
    )
    await waitFor(() => {
      expect(harness.highlightBlockFindTarget).toHaveBeenCalledTimes(1)
    })
    expect(harness.findCleanup).not.toHaveBeenCalled()

    harness.storeState.pendingScroll = {
      kind: "find-block",
      path: "/vault/title.md",
      blockId: "not-rendered",
      from: 0,
      to: 3,
      requestId: 8,
    }
    view.rerender(
      <BlockEditor
        initialMarkdown="# Title"
        onChangeMarkdown={vi.fn()}
        docKey="/vault/title.md#2"
      />,
    )
    await act(async () => Promise.resolve())

    expect(harness.findCleanup).toHaveBeenCalledTimes(1)
    expect(harness.highlightBlockFindTarget).toHaveBeenCalledTimes(1)
  })

  it("drops an asynchronous markdown export that finishes after unmount", async () => {
    const onChangeMarkdown = vi.fn()
    const view = render(
      <BlockEditor
        initialMarkdown="# Title"
        onChangeMarkdown={onChangeMarkdown}
        docKey="/vault/title.md#2"
      />,
    )
    await waitFor(() => {
      expect(harness.editor.replaceBlocks).toHaveBeenCalledTimes(1)
    })
    onChangeMarkdown.mockClear()

    let resolveExport!: (markdown: string) => void
    const exportResult = new Promise<string>((resolve) => {
      resolveExport = resolve
    })
    harness.editor.blocksToMarkdownLossy.mockReturnValue(exportResult)
    let pendingExport: Promise<void> | undefined
    await act(async () => {
      pendingExport = harness.onChange?.()
      await Promise.resolve()
    })
    expect(harness.editor.blocksToMarkdownLossy).toHaveBeenCalledTimes(1)

    view.unmount()
    await act(async () => {
      resolveExport("# Stale\n")
      await pendingExport
    })

    expect(onChangeMarkdown).not.toHaveBeenCalled()
  })
})
