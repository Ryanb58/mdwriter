import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { highlightBlockFindTarget } from "../blockFindHighlight"

const getClientRectsDescriptor = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getClientRects",
)
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
)

describe("highlightBlockFindTarget", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: vi.fn(() => [
        { left: 10, top: 20, width: 30, height: 12 },
        { left: 10, top: 32, width: 18, height: 12 },
      ]),
    })
  })

  afterEach(() => {
    document.body.innerHTML = ""
    restoreProperty(Range.prototype, "getClientRects", getClientRectsDescriptor)
    restoreProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor)
  })

  it("maps an exact range across formatted text nodes without mutating ProseMirror DOM", () => {
    const host = document.createElement("div")
    host.className = "ProseMirror"
    host.contentEditable = "true"
    host.innerHTML = [
      '<div data-id="block-a">',
      "  <span>Read </span>",
      "  <strong>the visible</strong>",
      "  <a> label</a>",
      "</div>",
    ].join("")
    document.body.append(host)
    const block = host.querySelector<HTMLElement>('[data-id="block-a"]')!
    const before = block.innerHTML
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
      left: 4,
      top: 8,
      width: 300,
      height: 200,
      right: 304,
      bottom: 208,
      x: 4,
      y: 8,
      toJSON: () => ({}),
    })
    Object.defineProperty(host, "scrollLeft", { configurable: true, value: 7 })
    Object.defineProperty(host, "scrollTop", { configurable: true, value: 11 })

    const firstText = block.querySelector("span")!.firstChild!
    const selectionRange = document.createRange()
    selectionRange.setStart(firstText, 2)
    selectionRange.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(selectionRange)
    const anchorBefore = selection.anchorNode
    const offsetBefore = selection.anchorOffset

    const result = highlightBlockFindTarget(
      host,
      { blockId: "block-a", from: 5, to: 22 },
      vi.fn(),
    )

    expect(result.exact).toBe(true)
    expect(block.innerHTML).toBe(before)
    expect(selection.anchorNode).toBe(anchorBefore)
    expect(selection.anchorOffset).toBe(offsetBefore)
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "auto",
    })
    const overlays = [...document.querySelectorAll<HTMLElement>(".block-find-highlight-overlay")]
    expect(overlays).toHaveLength(2)
    expect(overlays[0].parentElement).toBe(host)
    expect(overlays[0].style.left).toBe("13px")
    expect(overlays[0].style.top).toBe("23px")
    expect(overlays[0].style.width).toBe("30px")

    result.cleanup()
    expect(document.querySelector(".block-find-highlight-overlay")).toBeNull()
  })

  it("does not count text from nested block nodes toward the parent range", () => {
    const host = document.createElement("div")
    host.innerHTML = [
      '<div data-id="parent">Parent',
      '  <div data-id="child">Child</div>',
      "</div>",
    ].join("")
    document.body.append(host)
    const fallback = vi.fn()

    const result = highlightBlockFindTarget(
      host,
      { blockId: "parent", from: 6, to: 11 },
      fallback,
    )

    expect(result.exact).toBe(false)
    expect(fallback).toHaveBeenCalledWith(host.querySelector('[data-id="parent"]'))
  })

  it("falls back to the whole block when its text range cannot be mapped", () => {
    const host = document.createElement("div")
    host.innerHTML = '<div data-id="block-a"><span>Short</span></div>'
    document.body.append(host)
    const fallback = vi.fn()

    const result = highlightBlockFindTarget(
      host,
      { blockId: "block-a", from: 4, to: 99 },
      fallback,
    )

    expect(result.exact).toBe(false)
    expect(fallback).toHaveBeenCalledWith(host.querySelector('[data-id="block-a"]'))
    expect(document.querySelector(".block-find-highlight-overlay")).toBeNull()
  })

  it("maps table-cell offsets in the same text-node order as the rendered index", () => {
    const host = document.createElement("div")
    host.innerHTML = [
      '<div data-id="table">',
      "<table><tbody><tr>",
      "<td>Name</td>",
      "<td><strong>Visible link</strong></td>",
      "</tr><tr>",
      '<td><span class="wikilink">Alias</span></td>',
      "<td>Value</td>",
      "</tr></tbody></table>",
      "</div>",
    ].join("")
    document.body.append(host)
    const table = host.querySelector<HTMLElement>('[data-id="table"]')!
    const before = table.innerHTML

    const result = highlightBlockFindTarget(
      host,
      { blockId: "table", from: 12, to: 21 },
      vi.fn(),
    )

    expect(result.exact).toBe(true)
    expect(table.innerHTML).toBe(before)
    expect(document.querySelectorAll(".block-find-highlight-overlay")).toHaveLength(2)
  })

  it("uses the BlockNote content node when block IDs are repeated on wrappers", () => {
    const host = document.createElement("div")
    host.innerHTML = [
      '<div class="bn-block-outer" data-node-type="blockOuter" data-id="code">',
      '  <div class="bn-block" data-node-type="blockContainer" data-id="code">',
      '    <div class="bn-block-content" data-content-type="codeBlock">',
      '      <div contenteditable="false"><select><option>Plain Text</option></select></div>',
      "      <pre><code>Needle code</code></pre>",
      "    </div>",
      "  </div>",
      "</div>",
    ].join("")
    document.body.append(host)
    const fallback = vi.fn()
    let selectedText = ""
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: vi.fn(function (this: Range) {
        selectedText = this.toString()
        return [{ left: 10, top: 20, width: 30, height: 12 }]
      }),
    })

    const result = highlightBlockFindTarget(
      host,
      { blockId: "code", from: 0, to: 6 },
      fallback,
    )

    expect(result.exact).toBe(true)
    expect(selectedText).toBe("Needle")
    expect(fallback).not.toHaveBeenCalled()
  })

  it("keeps offsets aligned after a rendered hard break", () => {
    const host = document.createElement("div")
    host.innerHTML = [
      '<div class="bn-block" data-node-type="blockContainer" data-id="hard-break">',
      '  <div class="bn-block-content" data-content-type="paragraph">',
      '    <p class="bn-inline-content">First<br>Needle</p>',
      "  </div>",
      "</div>",
    ].join("")
    document.body.append(host)
    const fallback = vi.fn()
    let selectedText = ""
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: vi.fn(function (this: Range) {
        selectedText = this.toString()
        return [{ left: 10, top: 20, width: 30, height: 12 }]
      }),
    })

    const result = highlightBlockFindTarget(
      host,
      // BlockNote normalizes the hard break as one `\n` in block.content.
      { blockId: "hard-break", from: 6, to: 12 },
      fallback,
    )

    expect(result.exact).toBe(true)
    expect(selectedText).toBe("Needle")
    expect(fallback).not.toHaveBeenCalled()
  })

  it("excludes BlockNote table widgets from the rendered-text range", () => {
    const host = document.createElement("div")
    host.innerHTML = [
      '<div class="bn-block-outer" data-node-type="blockOuter" data-id="table-real">',
      '  <div class="bn-block" data-node-type="blockContainer" data-id="table-real">',
      '    <div class="bn-block-content" data-content-type="table">',
      '      <div class="tableWrapper">',
      '        <div class="tableWrapper-inner"><table><tbody><tr>',
      "          <td>Name</td><td>Visible link</td><td>Alias</td><td>Value</td>",
      "        </tr></tbody></table></div>",
      '        <div class="table-widgets-container">Drag me</div>',
      "      </div>",
      "    </div>",
      "  </div>",
      "</div>",
    ].join("")
    document.body.append(host)
    const fallback = vi.fn()
    let selectedText = ""
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: vi.fn(function (this: Range) {
        selectedText = this.toString()
        return [{ left: 10, top: 20, width: 30, height: 12 }]
      }),
    })

    const result = highlightBlockFindTarget(
      host,
      { blockId: "table-real", from: 21, to: 26 },
      fallback,
    )

    expect(result.exact).toBe(true)
    expect(selectedText).toBe("Value")
    expect(fallback).not.toHaveBeenCalled()

    result.cleanup()
    const widgetResult = highlightBlockFindTarget(
      host,
      { blockId: "table-real", from: 26, to: 33 },
      fallback,
    )
    expect(widgetResult.exact).toBe(false)
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it("fails quietly when the block disappeared before rendering", () => {
    const host = document.createElement("div")
    const fallback = vi.fn()

    const result = highlightBlockFindTarget(
      host,
      { blockId: "missing", from: 0, to: 3 },
      fallback,
    )

    expect(result.exact).toBe(false)
    expect(fallback).not.toHaveBeenCalled()
  })
})

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(target, key, descriptor)
  else Reflect.deleteProperty(target, key)
}
