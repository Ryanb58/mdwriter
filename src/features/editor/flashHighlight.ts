// Outlines paint at the compositor level — they sit above descendant
// backgrounds and aren't subject to ancestor transforms or stacking contexts,
// which is what makes inline `outline` on the target element a reliable flash
// in places where positioned overlays got eaten (notably BlockNote's Mantine
// tree).
const FLASH_HOLD_MS = 800
const FLASH_FADE_MS = 1200
const FLASH_TOTAL_MS = FLASH_HOLD_MS + FLASH_FADE_MS + 200

/** Briefly highlight `el` and fade back to normal. */
export function flashHighlight(el: HTMLElement | null | undefined) {
  if (!el) return
  const prevOutline = el.style.outline
  const prevOutlineOffset = el.style.outlineOffset
  const prevBackground = el.style.background
  const prevTransition = el.style.transition

  el.style.outline = "3px solid #f59e0b"
  el.style.outlineOffset = "0px"
  el.style.background = "rgba(252, 211, 77, 0.45)"

  window.setTimeout(() => {
    el.style.transition = `outline-color ${FLASH_FADE_MS}ms ease-out, background-color ${FLASH_FADE_MS}ms ease-out`
    el.style.outlineColor = "transparent"
    el.style.background = "transparent"
  }, FLASH_HOLD_MS)

  window.setTimeout(() => {
    el.style.outline = prevOutline
    el.style.outlineOffset = prevOutlineOffset
    el.style.background = prevBackground
    el.style.transition = prevTransition
  }, FLASH_TOTAL_MS)
}

