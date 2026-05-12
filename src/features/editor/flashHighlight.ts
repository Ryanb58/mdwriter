// We tried several approaches; the one the user could actually see was an
// absolute-positioned overlay appended to `document.body`. Inline styles on
// the target element alone (outline + background) were applied correctly but
// invisible — BlockNote's Mantine block tree paints children with their own
// backgrounds that hide the parent. Sibling-of-body positioning sidesteps
// that entire stacking-context problem.
const FLASH_HOLD_MS = 800
const FLASH_FADE_MS = 1200
const FLASH_TOTAL_MS = FLASH_HOLD_MS + FLASH_FADE_MS + 200

/** Briefly highlight `el` with a fading yellow overlay (~2s total). */
export function flashHighlight(el: HTMLElement | null | undefined) {
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return

  const overlay = document.createElement("div")
  overlay.style.cssText = [
    "position: absolute",
    `left: ${rect.left + window.scrollX - 2}px`,
    `top: ${rect.top + window.scrollY - 2}px`,
    `width: ${rect.width + 4}px`,
    `height: ${rect.height + 4}px`,
    "pointer-events: none",
    "background: rgba(252, 211, 77, 0.45)",
    "border: 3px solid #f59e0b",
    "border-radius: 4px",
    "z-index: 2147483647",
    "opacity: 1",
    `transition: opacity ${FLASH_FADE_MS}ms ease-out`,
  ].join("; ")
  document.body.appendChild(overlay)

  window.setTimeout(() => {
    overlay.style.opacity = "0"
  }, FLASH_HOLD_MS)

  window.setTimeout(() => {
    overlay.remove()
  }, FLASH_TOTAL_MS)
}

