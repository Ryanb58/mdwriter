import { flashHighlight } from "./flashHighlight"

export type BlockFindRange = {
  blockId: string
  from: number
  to: number
}

export type BlockFindHighlightResult = {
  exact: boolean
  cleanup: () => void
}

/**
 * Draw exact-range overlays outside BlockNote's ProseMirror-owned DOM.
 * Returns a cleanup handle so the caller can replace or immediately clear it.
 */
export function highlightBlockFindTarget(
  host: HTMLElement,
  target: BlockFindRange,
  fallback: (block: HTMLElement) => void = flashHighlight,
): BlockFindHighlightResult {
  const block = findBlockElement(host, target.blockId)
  if (!block) return emptyResult()

  block.scrollIntoView?.({ block: "center", behavior: "auto" })
  const range = createTextRange(block, target.from, target.to)
  if (!range) {
    fallback(block)
    return emptyResult()
  }

  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  )
  if (rects.length === 0) {
    fallback(block)
    return emptyResult()
  }

  const hostRect = host.getBoundingClientRect()
  const overlays = rects.map((rect) => {
    const overlay = document.createElement("div")
    overlay.className = "block-find-highlight-overlay"
    // The editor host is the scrolling container. Anchoring inside it keeps
    // the highlight attached to its text while that pane scrolls.
    overlay.style.left = `${rect.left - hostRect.left + host.scrollLeft}px`
    overlay.style.top = `${rect.top - hostRect.top + host.scrollTop}px`
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
    host.appendChild(overlay)
    return overlay
  })

  return {
    exact: true,
    cleanup: () => overlays.forEach((overlay) => overlay.remove()),
  }
}

function findBlockElement(host: HTMLElement, blockId: string): HTMLElement | null {
  let fallback: HTMLElement | null = null
  for (const element of host.querySelectorAll<HTMLElement>("[data-id]")) {
    if (element.dataset.id !== blockId) continue
    if (element.dataset.nodeType === "blockContainer") return element
    if (element.classList.contains("bn-block")) return element
    fallback ??= element
  }
  return fallback
}

function createTextRange(
  block: HTMLElement,
  from: number,
  to: number,
): Range | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
    return null
  }

  const segments = renderedTextSegments(block)
  const totalLength = segments.reduce((total, segment) => total + segment.length, 0)
  if (to > totalLength) return null

  const start = textPoint(segments, from, "start")
  const end = textPoint(segments, to, "end")
  if (!start || !end) return null

  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

type RenderedTextSegment =
  | { kind: "text"; node: Text; length: number }
  | { kind: "break"; node: HTMLBRElement; length: 1 }

function renderedTextSegments(block: HTMLElement): RenderedTextSegment[] {
  const segments: RenderedTextSegment[] = []
  for (const root of renderedTextRoots(block)) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    )
    let current = walker.nextNode()
    while (current) {
      if (current instanceof Text && belongsToBlock(current, block)) {
        segments.push({ kind: "text", node: current, length: current.length })
      } else if (
        current instanceof HTMLBRElement &&
        !current.classList.contains("ProseMirror-trailingBreak") &&
        belongsToBlock(current, block)
      ) {
        // BlockNote serializes a hard break as one `\n`, while ProseMirror
        // renders it as a <br>. Count that virtual character so later source
        // offsets still land on the corresponding DOM text.
        segments.push({ kind: "break", node: current, length: 1 })
      }
      current = walker.nextNode()
    }
  }
  return segments
}

function renderedTextRoots(block: HTMLElement): HTMLElement[] {
  const content = ownBlockContent(block)
  if (!content) return [block]

  if (content.dataset.contentType === "codeBlock") {
    const code = content.querySelector<HTMLElement>("pre code")
    return code ? [code] : [content]
  }

  if (content.dataset.contentType === "table") {
    const table = content.querySelector<HTMLElement>(".tableWrapper-inner")
      ?? content.querySelector<HTMLElement>("table")
    if (!table) return [content]
    const cells = [...table.querySelectorAll<HTMLElement>("th, td")]
    return cells.length > 0 ? cells : [table]
  }

  const inlineContent = [...content.querySelectorAll<HTMLElement>(".bn-inline-content")]
  return inlineContent.length > 0 ? inlineContent : [content]
}

function ownBlockContent(block: HTMLElement): HTMLElement | null {
  for (const content of block.querySelectorAll<HTMLElement>(".bn-block-content")) {
    const container = content.closest<HTMLElement>('[data-node-type="blockContainer"]')
    if (!container || container === block) return content
  }
  return null
}

function belongsToBlock(node: Node, block: HTMLElement): boolean {
  let element = node.parentElement
  while (element && element !== block) {
    if (element.hasAttribute("data-id")) return false
    element = element.parentElement
  }
  return element === block
}

function textPoint(
  segments: readonly RenderedTextSegment[],
  target: number,
  edge: "start" | "end",
): { node: Node; offset: number } | null {
  let consumed = 0
  for (const segment of segments) {
    const next = consumed + segment.length
    if (target < next || (edge === "end" && target === next)) {
      return pointInSegment(segment, target - consumed)
    }
    consumed = next
  }
  if (target === consumed && segments.length > 0) {
    const last = segments[segments.length - 1]
    return pointInSegment(last, last.length)
  }
  return null
}

function pointInSegment(
  segment: RenderedTextSegment,
  offset: number,
): { node: Node; offset: number } | null {
  if (segment.kind === "text") return { node: segment.node, offset }
  const parent = segment.node.parentNode
  if (!parent) return null
  const index = Array.prototype.indexOf.call(parent.childNodes, segment.node) as number
  if (index < 0) return null
  return { node: parent, offset: index + (offset > 0 ? 1 : 0) }
}

function emptyResult(): BlockFindHighlightResult {
  return { exact: false, cleanup: () => {} }
}
