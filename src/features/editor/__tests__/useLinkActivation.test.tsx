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
  children: [
    { kind: "file", name: "Three laws of motion.md", path: "/vault/Three laws of motion.md" },
    { kind: "file", name: "Inertia.md", path: "/vault/Inertia.md" },
  ],
}

function Host() {
  const ref = useRef<HTMLDivElement>(null)
  useLinkActivation(ref)
  return (
    <div ref={ref} data-testid="host" contentEditable suppressContentEditableWarning>
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

function clickHTMLElement(
  el: HTMLElement,
  opts: { metaKey?: boolean; ctrlKey?: boolean } = {},
) {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, ...opts })
  el.dispatchEvent(ev)
  return ev
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
    Reflect.deleteProperty(window.navigator, "platform")
  })

  it("keeps a bare wikilink click as an editing gesture", () => {
    const { getByText } = render(<Host />)
    const event = clickHTMLElement(getByText("3LoM"))
    expect(event.defaultPrevented).toBe(false)
    expect(useStore.getState().selectedPath).toBeNull()
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
