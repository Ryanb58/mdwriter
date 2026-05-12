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

