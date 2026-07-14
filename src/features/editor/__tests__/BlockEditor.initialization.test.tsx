import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => {
  const storeState = {
    pendingScroll: null,
    openDoc: null,
    pendingCursorAtEnd: null,
    setPendingScroll: vi.fn(),
    setPendingCursorAtEnd: vi.fn(),
    setEditorSelection: vi.fn(),
    setHeadingCommittedPath: vi.fn(),
  }
  const editor = {
    document: [{ id: "empty", type: "paragraph", content: [] }],
    tryParseMarkdownToBlocks: vi.fn(),
    replaceBlocks: vi.fn(),
    blocksToMarkdownLossy: vi.fn(),
    isFocused: vi.fn(() => true),
    setTextCursorPosition: vi.fn(),
    focus: vi.fn(),
    onSelectionChange: vi.fn(() => vi.fn()),
    getSelectedText: vi.fn(() => ""),
  }

  return {
    editor,
    onChange: null as null | (() => Promise<void>),
    storeState,
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
      return React.createElement("div")
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

import { BlockEditor } from "../BlockEditor"

describe("BlockEditor initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.onChange = null
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
})
