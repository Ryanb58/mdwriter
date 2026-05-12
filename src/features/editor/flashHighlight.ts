// Body-appended overlay sized to the target's bounding rect. Inline styles
// on the target itself are invisible in BlockNote's tree (descendants paint
// over the parent), so we sidestep editor stacking contexts entirely by
// living next to <body>. Colors + animation come from `.search-flash-overlay`
// in App.css — light/dark variants are CSS-driven.
const FLASH_DURATION_MS = 1500

/** Briefly highlight `el` with a fading blue overlay. */
export function flashHighlight(el: HTMLElement | null | undefined) {
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return

  const overlay = document.createElement("div")
  overlay.className = "search-flash-overlay"
  overlay.style.left = `${rect.left + window.scrollX - 2}px`
  overlay.style.top = `${rect.top + window.scrollY - 2}px`
  overlay.style.width = `${rect.width + 4}px`
  overlay.style.height = `${rect.height + 4}px`
  document.body.appendChild(overlay)

  const cleanup = () => overlay.remove()
  overlay.addEventListener("animationend", cleanup, { once: true })
  // Belt-and-suspenders: if `animationend` doesn't fire (interrupted, etc.)
  // remove the overlay anyway after the animation window.
  window.setTimeout(cleanup, FLASH_DURATION_MS + 200)
}

