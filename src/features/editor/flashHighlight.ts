/**
 * Briefly mark the target line/block after a search-result jump. Uses the
 * Web Animations API so the styles are applied via the browser's animation
 * engine (beats regular CSS specificity, immune to ancestor transforms or
 * stylesheet pickup issues).
 *
 * Visual: a 4px accent stripe along the left edge (inset box-shadow) paired
 * with a soft background tint. The stripe sits inside the element's padding
 * box, so it shows up cleanly even when children paint their own backgrounds
 * over the parent. Fade duration is intentionally a bit longer (~1s) so the
 * eye has time to land on it before it disappears.
 */
export function flashHighlight(el: HTMLElement | null | undefined) {
  console.log("[flashHighlight] called with:", el)
  if (!el) {
    console.warn("[flashHighlight] element is null/undefined")
    return
  }

  // Inject a positioned overlay as a child of the target element. Sitting
  // inside the target means the overlay shares its containing block and
  // moves with it through any scrolling — no position:fixed weirdness, no
  // ancestor-transform issues.
  const overlay = document.createElement("div")
  overlay.style.cssText = [
    "position: absolute",
    "inset: -2px",
    "pointer-events: none",
    "background: oklch(0.85 0.22 95 / 0.55)",
    "outline: 3px solid oklch(0.55 0.25 95)",
    "outline-offset: 0",
    "border-radius: 4px",
    "z-index: 2147483640",
    "opacity: 1",
    "transition: opacity 1200ms ease-out",
  ].join("; ")

  // The target needs `position: relative` (or any non-static) for inset to
  // size against it. Capture the original to restore on cleanup.
  const previousPosition = el.style.position
  const computed =
    typeof window !== "undefined" ? window.getComputedStyle(el).position : "static"
  if (computed === "static") el.style.position = "relative"

  el.appendChild(overlay)
  const rect = el.getBoundingClientRect()
  console.log("[flashHighlight] overlay inserted, parent rect:", rect)

  // Hold full opacity for ~800ms, then fade to 0 via CSS transition (1200ms).
  // Total visible window ≈ 2s.
  window.setTimeout(() => {
    overlay.style.opacity = "0"
    console.log("[flashHighlight] fading")
  }, 800)

  const cleanup = () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
    if (computed === "static") el.style.position = previousPosition
    console.log("[flashHighlight] cleaned up")
  }
  overlay.addEventListener("transitionend", cleanup, { once: true })
  // Safety net: opacity transition ends ~2000ms after insertion. Pad to 2400.
  window.setTimeout(cleanup, 2400)
}

