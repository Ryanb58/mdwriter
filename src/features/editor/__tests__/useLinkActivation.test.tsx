import { afterEach, describe, it, expect, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { useRef } from "react"
import { useLinkActivation } from "../useLinkActivation"
import { useStore } from "../../../lib/store"
import type { TreeNode } from "../../../lib/ipc"

const tree: TreeNode = {
  kind: "dir",
  name: "vault",
  path: "/vault",
  loaded: true,
  children: [
    { kind: "file", name: "Three laws of motion.md", path: "/vault/Three laws of motion.md" },
    { kind: "file", name: "Inertia.md", path: "/vault/Inertia.md" },
  ],
}

function Host() {
  const ref = useRef<HTMLDivElement>(null)
  useLinkActivation(ref)
  return (
    <div
      ref={ref}
      className="ProseMirror"
      data-testid="host"
      contentEditable
      suppressContentEditableWarning
    >
      <p>
        <span className="wikilink" data-target="Three laws of motion">3LoM</span>
      </p>
      <p>
        <a href="Inertia.md">Inertia</a>
      </p>
      <p>
        <a href="https://example.com" onClick={(event) => event.preventDefault()}>External</a>
      </p>
      <p>
        <span className="wikilink" data-target="Nonexistent">missing</span>
      </p>
    </div>
  )
}

function CodeMirrorHost() {
  const ref = useRef<HTMLDivElement>(null)
  useLinkActivation(ref)
  return (
    <div ref={ref}>
      <div className="cm-content" contentEditable suppressContentEditableWarning>
        <span className="wikilink" data-target="Three laws of motion">3LoM</span>
      </div>
    </div>
  )
}

function clickHTMLElement(
  el: HTMLElement,
  opts: { metaKey?: boolean; ctrlKey?: boolean } = {},
) {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, ...opts })
  el.dispatchEvent(ev)
  return ev
}

function clickFromPointer(
  el: HTMLElement,
  opts: { metaKey?: boolean; ctrlKey?: boolean } = {},
) {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, ...opts }))
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, ...opts }))
  return clickHTMLElement(el, opts)
}

function placeCaret(el: HTMLElement, offset: number) {
  const text = el.firstChild
  if (!(text instanceof Text)) throw new Error("Expected link text")

  const range = document.createRange()
  range.setStart(text, offset)
  range.collapse(true)

  const selection = window.getSelection()
  if (!selection) throw new Error("Expected a DOM selection")
  selection.removeAllRanges()
  selection.addRange(range)

  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
  }
}

function expectCaretToEqual(expected: ReturnType<typeof placeCaret>) {
  const selection = window.getSelection()
  expect(selection?.anchorNode).toBe(expected.anchorNode)
  expect(selection?.anchorOffset).toBe(expected.anchorOffset)
  expect(selection?.focusNode).toBe(expected.focusNode)
  expect(selection?.focusOffset).toBe(expected.focusOffset)
}

describe("useLinkActivation", () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "Win32",
    })
    const s = useStore.getState()
    s.setRoot("/vault")
    s.setTree(tree)
    s.setSelected(null)
  })

  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    Reflect.deleteProperty(window.navigator, "platform")
  })

  it("keeps a bare BlockNote wikilink click as an editing gesture without moving the caret", () => {
    const { getByText } = render(<Host />)
    const link = getByText("3LoM")
    const caret = placeCaret(link, 2)
    const event = clickFromPointer(link)
    expect(event.defaultPrevented).toBe(false)
    expect(useStore.getState().selectedPath).toBeNull()
    expectCaretToEqual(caret)
  })

  it("keeps a bare CodeMirror wikilink click as an editing gesture without moving the caret", () => {
    const { getByText } = render(<CodeMirrorHost />)
    const link = getByText("3LoM")
    const caret = placeCaret(link, 2)
    const event = clickFromPointer(link)
    expect(event.defaultPrevented).toBe(false)
    expect(useStore.getState().selectedPath).toBeNull()
    expectCaretToEqual(caret)
  })

  it("opens a resolved wikilink on Ctrl-click outside Apple platforms", () => {
    const { getByText } = render(<Host />)
    const event = clickHTMLElement(getByText("3LoM"), { ctrlKey: true })
    expect(useStore.getState().selectedPath).toBe("/vault/Three laws of motion.md")
    expect(event.defaultPrevented).toBe(true)
  })

  it("opens a resolved wikilink on Cmd-click on macOS", () => {
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    })
    const { getByText } = render(<Host />)
    clickHTMLElement(getByText("3LoM"), { metaKey: true })
    expect(useStore.getState().selectedPath).toBe("/vault/Three laws of motion.md")
  })

  it("ignores the wrong modifier for the platform", () => {
    const { getByText } = render(<Host />)
    clickHTMLElement(getByText("3LoM"), { metaKey: true })
    expect(useStore.getState().selectedPath).toBeNull()
  })

  it("opens an internal markdown link only with the platform modifier", () => {
    const { getByText } = render(<Host />)
    clickHTMLElement(getByText("Inertia"), { ctrlKey: true })
    expect(useStore.getState().selectedPath).toBe("/vault/Inertia.md")
  })

  it("ignores external links", () => {
    const { getByText } = render(<Host />)
    clickHTMLElement(getByText("External"), { ctrlKey: true })
    expect(useStore.getState().selectedPath).toBeNull()
  })

  it("does nothing for unresolved wikilinks", () => {
    const { getByText } = render(<Host />)
    clickHTMLElement(getByText("missing"), { ctrlKey: true })
    expect(useStore.getState().selectedPath).toBeNull()
  })
})
