import { useState } from "react"
import { act, cleanup, render, screen } from "@testing-library/react"
import { defaultKeymap } from "@codemirror/commands"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { RawWikilinkPopup } from "../RawWikilinkPopup"
import { rawMarkdownExtensions } from "../rawMarkdownExtensions"
import type { WikilinkCompletionState } from "../wikilinkCM"

const notes = [{ name: "Note", path: "/vault/Note.md", rel: "Note.md" }]
const views: EditorView[] = []
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")

beforeAll(() => {
  // jsdom has no scrolling implementation; the popup scrolls its active result.
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() })
})

afterAll(() => {
  if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoView)
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
})

afterEach(() => {
  cleanup()
  for (const view of views.splice(0)) {
    view.destroy()
    view.dom.remove()
  }
  vi.restoreAllMocks()
})

function openPopup(hasResults = true) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: "[[]]",
      selection: { anchor: 2 },
      extensions: [rawMarkdownExtensions(), keymap.of(defaultKeymap)],
    }),
  })
  views.push(view)
  const onDismiss = vi.fn()
  function Popup() {
    const [state, setState] = useState<WikilinkCompletionState | null>({
      from: 0, to: 2, query: "", coords: { left: 0, top: 0, bottom: 20 },
    })
    return <RawWikilinkPopup
      state={state}
      notes={hasResults ? notes : []}
      viewRef={{ current: view }}
      onDismiss={() => {
        onDismiss()
        setState(null)
      }}
    />
  }
  render(<Popup />)
  view.focus()
  expect(screen.getByText("Link a note")).toBeInTheDocument()
  return { view, onDismiss }
}

function press(view: EditorView, key: string, shiftKey = false) {
  // CodeMirror's built-in tab-focus handling reads keyCode as well as key.
  const keyCode = { Escape: 27, Tab: 9, Enter: 13, ArrowRight: 39 }[key] ?? 0
  const event = new KeyboardEvent("keydown", { key, keyCode, shiftKey, bubbles: true, cancelable: true })
  act(() => { view.contentDOM.dispatchEvent(event) })
  return event
}

describe("raw wikilink popup keyboard focus", () => {
  it.each([false, true])("lets Escape then Tab leave the editor (Shift: %s)", (shift) => {
    const { view, onDismiss } = openPopup()
    const selection = view.state.selection

    expect(press(view, "Escape").defaultPrevented).toBe(true)
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(screen.queryByText("Link a note")).not.toBeInTheDocument()
    // jsdom doesn't perform native Tab navigation. An uncancelled event is
    // what permits the browser to move focus instead of indenting/completing.
    expect(press(view, "Tab", shift).defaultPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe("[[]]")
    expect(view.state.selection.eq(selection)).toBe(true)
  })

  it("also enables tab focus when the dismissed popup has no results", () => {
    const { view, onDismiss } = openPopup(false)
    press(view, "Escape")
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(press(view, "Tab").defaultPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe("[[]]")
  })

  it.each(["Tab", "Enter"])("still accepts a completion with %s before dismissal", (key) => {
    const { view, onDismiss } = openPopup()
    expect(press(view, key).defaultPrevented).toBe(true)
    expect(view.state.doc.toString()).toBe("[[Note]]")
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it("restores normal indentation when another key cancels temporary tab focus", () => {
    const { view } = openPopup()
    press(view, "Escape")
    press(view, "ArrowRight")
    expect(press(view, "Tab").defaultPrevented).toBe(true)
    expect(view.state.doc.toString()).toBe("    [[]]")
  })

  it("uses CodeMirror's temporary timeout rather than permanently disabling indentation", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10000)
    const { view } = openPopup()
    press(view, "Escape")
    now.mockReturnValue(12001)
    expect(press(view, "Tab").defaultPrevented).toBe(true)
    expect(view.state.doc.toString()).toBe("    [[]]")
  })

  it("does not downgrade explicitly enabled permanent tab-focus mode", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10000)
    const { view } = openPopup()
    view.setTabFocusMode(true)
    press(view, "Escape")
    now.mockReturnValue(12001)
    expect(press(view, "Tab").defaultPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe("[[]]")
  })
})
