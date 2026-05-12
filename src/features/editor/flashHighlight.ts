/**
 * Briefly paint a fading highlight at a viewport-space rect — used after a
 * search-result jump to draw the user's eye to the matched text. The element
 * is `position: fixed`, so it stays on screen during the 500ms fade even if
 * the document scrolls slightly. After the animation it removes itself.
 *
 * Styling lives in `.search-flash` in App.css.
 */
export function flashHighlight(rect: { left: number; top: number; width: number; height: number }) {
  if (rect.width <= 0 || rect.height <= 0) return
  const el = document.createElement("div")
  el.className = "search-flash"
  // Pad a hair to make the flash read as a highlight, not as text.
  const pad = 2
  el.style.left = `${rect.left - pad}px`
  el.style.top = `${rect.top - pad}px`
  el.style.width = `${rect.width + pad * 2}px`
  el.style.height = `${rect.height + pad * 2}px`
  document.body.appendChild(el)
  const remove = () => {
    if (el.parentNode) el.parentNode.removeChild(el)
  }
  el.addEventListener("animationend", remove, { once: true })
  // Defensive fallback — if animationend never fires (browser quirk or
  // animation interrupted), remove the overlay anyway after the fade.
  window.setTimeout(remove, 800)
}

/**
 * Find the Nth case-insensitive occurrence of `needle` inside `root`'s text
 * content and return its DOMRange. Used to compute a viewport rect for
 * `flashHighlight`. Skips matches that span across element boundaries — a
 * limitation for matches that cross inline formatting (rare in practice).
 */
export function findTextRangeIn(
  root: HTMLElement,
  needle: string,
  occurrence: number,
): Range | null {
  if (!needle) return null
  const n = needle.toLowerCase()
  const target = Math.max(0, Math.floor(occurrence))
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Hidden elements have no useful range; skip.
      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_SKIP
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let count = 0
  let lastRange: Range | null = null
  let node: Node | null = walker.nextNode()
  while (node) {
    const text = (node as Text).nodeValue ?? ""
    if (text.length > 0) {
      const lower = text.toLowerCase()
      let i = 0
      while ((i = lower.indexOf(n, i)) >= 0) {
        const range = document.createRange()
        range.setStart(node, i)
        range.setEnd(node, i + needle.length)
        if (count === target) return range
        lastRange = range
        count++
        i += needle.length
      }
    }
    node = walker.nextNode()
  }
  // Doc may have shifted; fall back to the last available match rather than
  // skipping the highlight entirely.
  return lastRange
}
