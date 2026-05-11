import { describe, it, expect, beforeEach } from "vitest"
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
    <div ref={ref} data-testid="host">
      <p>
        <span className="wikilink" data-target="Three laws of motion">3LoM</span>
      </p>
      <p>
        <a href="Inertia.md">Inertia</a>
      </p>
      <p>
        <a href="https://example.com">External</a>
      </p>
      <p>
        <span className="wikilink" data-target="Nonexistent">missing</span>
      </p>
    </div>
  )
}

function clickHTMLElement(el: HTMLElement, opts: { metaKey?: boolean } = {}) {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, ...opts })
  el.dispatchEvent(ev)
}

describe("useLinkActivation", () => {
  beforeEach(() => {
    const s = useStore.getState()
    s.setRoot("/vault")
    s.setTree(tree)
    s.setSelected(null)
  })

  it("opens a wikilink to a resolvable note", () => {
    const { getByText } = render(<Host />)
    clickHTMLElement(getByText("3LoM"))
    expect(useStore.getState().selectedPath).toBe("/vault/Three laws of motion.md")
  })

  it("opens an internal markdown link", () => {
    const { getByText } = render(<Host />)
    clickHTMLElement(getByText("Inertia"))
    expect(useStore.getState().selectedPath).toBe("/vault/Inertia.md")
  })

  it("ignores external links", () => {
    const { getByText } = render(<Host />)
    clickHTMLElement(getByText("External"))
    expect(useStore.getState().selectedPath).toBeNull()
  })

  it("does nothing for unresolved wikilinks", () => {
    const { getByText } = render(<Host />)
    clickHTMLElement(getByText("missing"))
    expect(useStore.getState().selectedPath).toBeNull()
  })
})
