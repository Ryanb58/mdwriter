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
  if (typeof el.animate !== "function") {
    console.warn("[flashHighlight] el.animate is not a function", el)
    return
  }

  const rect = el.getBoundingClientRect()
  console.log("[flashHighlight] target rect:", rect, "tag:", el.tagName, "class:", el.className)

  // Inject a positioned overlay as a *child* of the target element. Living
  // inside the target means it inherits the same containing block — we
  // sidestep all the position:fixed/ancestor-transform issues that ate the
  // previous attempts. The overlay covers the target via `inset: 0`.
  const overlay = document.createElement("div")
  overlay.style.cssText = [
    "position: absolute",
    "inset: 0",
    "pointer-events: none",
    "background: oklch(0.85 0.22 95 / 0.75)",
    "outline: 3px solid oklch(0.55 0.25 95)",
    "outline-offset: 0",
    "border-radius: 4px",
    "z-index: 2147483640",
  ].join("; ")

  // The target needs `position: relative` (or any non-static) for `inset: 0`
  // on the overlay to size against it. Capture the original and restore.
  const previousPosition = el.style.position
  const computed =
    typeof window !== "undefined" ? window.getComputedStyle(el).position : "static"
  if (computed === "static") el.style.position = "relative"

  el.appendChild(overlay)

  const animation = overlay.animate(
    [{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }],
    { duration: 900, easing: "ease-out", fill: "forwards" },
  )

  const cleanup = () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
    if (computed === "static") el.style.position = previousPosition
  }
  animation.addEventListener("finish", cleanup, { once: true })
  animation.addEventListener("cancel", cleanup, { once: true })
  // Safety net in case neither event fires.
  window.setTimeout(cleanup, 1200)

  console.log("[flashHighlight] overlay inserted, animation started")
}

