import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const harness = vi.hoisted(() => ({
  extensions: [] as unknown[],
  raf: null as FrameRequestCallback | null,
  lineWrapping: { name: "line-wrapping" },
  history: { name: "history" },
  keymap: { name: "keymap" },
  lineNumbers: { name: "line-numbers" },
  markdown: { name: "markdown" },
  links: { name: "links" },
  completion: { name: "completion" },
  theme: { name: "theme" },
  rawFindField: { name: "raw-find-field" },
  rawFindTheme: { name: "raw-find-theme" },
  updateListener: { name: "update-listener" },
  focus: vi.fn(),
  destroy: vi.fn(),
  useRawImagePaste: vi.fn(),
  useLinkActivation: vi.fn(),
  applyRawFindHighlight: vi.fn(),
  scrollViewToMatch: vi.fn(),
  storeState: {
    pendingCursorAtEnd: null as string | null,
    pendingScroll: null as null | {
      kind: "find-raw" | "vault-reveal"
      path: string
      from?: number
      to?: number
      requestId?: number
      matchText?: string
      occurrence?: number
      line?: number
    },
    openDoc: { path: "/vault/note.md" },
    setPendingCursorAtEnd: vi.fn(),
    setPendingScroll: vi.fn(),
    setEditorSelection: vi.fn(),
  },
}))

vi.mock("@codemirror/state", () => ({
  EditorState: {
    create: vi.fn((config: { doc: string; extensions: unknown[] }) => {
      harness.extensions = config.extensions
      return {
        doc: {
          length: config.doc.length,
          toString: () => config.doc,
        },
        selection: { main: { from: 0, to: 0 } },
        sliceDoc: () => "",
      }
    }),
  },
}))

vi.mock("@codemirror/view", () => {
  class EditorView {
    static lineWrapping = harness.lineWrapping
    static theme = vi.fn(() => harness.theme)
    static updateListener = { of: vi.fn(() => harness.updateListener) }

    state: ReturnType<typeof Object>

    constructor(config: { state: ReturnType<typeof Object> }) {
      this.state = config.state
    }

    dispatch = vi.fn()
    focus = harness.focus
    destroy = harness.destroy
  }

  return {
    EditorView,
    keymap: { of: vi.fn(() => harness.keymap) },
    lineNumbers: vi.fn(() => harness.lineNumbers),
  }
})

vi.mock("@codemirror/commands", () => ({
  defaultKeymap: [],
  history: vi.fn(() => harness.history),
  historyKeymap: [],
}))

vi.mock("@codemirror/lang-markdown", () => ({
  markdown: vi.fn(() => harness.markdown),
}))

vi.mock("../useRawImagePaste", () => ({
  useRawImagePaste: harness.useRawImagePaste,
}))

vi.mock("../useLinkActivation", () => ({
  useLinkActivation: harness.useLinkActivation,
}))

vi.mock("../../../lib/vaultNotes", () => ({
  useVaultNotes: () => [],
}))

vi.mock("../../../lib/store", () => {
  const useStore = Object.assign(
    (selector: (state: typeof harness.storeState) => unknown) =>
      selector(harness.storeState),
    { getState: () => harness.storeState },
  )
  return { useStore }
})

vi.mock("../wikilinkCM", () => ({
  decorateLinks: vi.fn(() => harness.links),
  rebuildLinkDecorations: { of: vi.fn() },
  wikilinkCompletion: vi.fn(() => ({
    extension: harness.completion,
    dismiss: vi.fn(),
  })),
}))

vi.mock("../RawWikilinkPopup", () => ({
  RawWikilinkPopup: () => null,
}))

vi.mock("../scrollViewToMatch", () => ({
  scrollViewToMatch: harness.scrollViewToMatch,
}))

vi.mock("../flashHighlight", () => ({
  flashHighlight: vi.fn(),
}))

vi.mock("../rawFindHighlight", () => ({
  rawFindHighlightField: harness.rawFindField,
  rawFindHighlightTheme: harness.rawFindTheme,
  applyRawFindHighlight: harness.applyRawFindHighlight,
}))

import { RawEditor } from "../RawEditor"

describe("RawEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.extensions = []
    harness.raf = null
    harness.storeState.pendingCursorAtEnd = null
    harness.storeState.pendingScroll = null
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      harness.raf = callback
      return 1
    }))
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("installs line wrapping alongside the existing raw editing extensions", () => {
    render(<RawEditor value="# Note" onChange={vi.fn()} />)

    expect(harness.extensions).toEqual(expect.arrayContaining([
      harness.history,
      harness.keymap,
      harness.lineNumbers,
      harness.markdown,
      harness.links,
      harness.completion,
      harness.lineWrapping,
      harness.rawFindField,
      harness.rawFindTheme,
      harness.theme,
      harness.updateListener,
    ]))
    expect(harness.useRawImagePaste).toHaveBeenCalledTimes(1)
    expect(harness.useLinkActivation).toHaveBeenCalledTimes(1)
  })

  it("restores focus on the next animation frame after mounting", () => {
    render(<RawEditor value="# Note" onChange={vi.fn()} />)

    expect(harness.focus).not.toHaveBeenCalled()
    expect(harness.raf).not.toBeNull()

    act(() => harness.raf?.(0))

    expect(harness.focus).toHaveBeenCalledTimes(1)
  })

  it("keeps Find focused while placing a new note cursor at the end", () => {
    harness.storeState.pendingCursorAtEnd = "/vault/note.md"
    const find = render(<div data-find-bar><input aria-label="Find in note" /></div>)
    const input = find.getByRole("textbox", { name: "Find in note" })
    input.focus()

    render(<RawEditor value="# Note" onChange={vi.fn()} />)
    act(() => harness.raf?.(0))

    expect(input).toHaveFocus()
    expect(harness.focus).not.toHaveBeenCalled()
    expect(harness.storeState.setPendingCursorAtEnd).toHaveBeenCalledWith(null)
  })

  it("applies an exact raw Find target without consuming it", () => {
    harness.storeState.pendingScroll = {
      kind: "find-raw",
      path: "/vault/note.md",
      from: 3,
      to: 7,
      requestId: 1,
    }

    render(<RawEditor value="# Note" onChange={vi.fn()} />)
    act(() => harness.raf?.(0))

    expect(harness.applyRawFindHighlight).toHaveBeenCalledWith(
      expect.anything(),
      { from: 3, to: 7 },
    )
    expect(harness.storeState.setPendingScroll).not.toHaveBeenCalled()
    expect(harness.focus).not.toHaveBeenCalled()
  })

  it("preserves the vault reveal fallback and consumes that one-shot target", () => {
    harness.storeState.pendingScroll = {
      kind: "vault-reveal",
      path: "/vault/note.md",
      line: 4,
      matchText: "Note",
      occurrence: 0,
    }
    harness.scrollViewToMatch.mockReturnValue(null)

    render(<RawEditor value="# Note" onChange={vi.fn()} />)
    act(() => harness.raf?.(0))

    expect(harness.scrollViewToMatch).toHaveBeenCalledWith(
      expect.anything(),
      "Note",
      0,
      4,
    )
    expect(harness.storeState.setPendingScroll).toHaveBeenCalledWith(null)
  })
})
