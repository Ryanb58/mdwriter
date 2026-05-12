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
  if (!el || typeof el.animate !== "function") {
    if (typeof console !== "undefined") {
      console.debug("[flashHighlight] no element or animate() unavailable", el)
    }
    return
  }
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")

  const stripe = isDark ? "oklch(0.78 0.20 95)" : "oklch(0.62 0.22 95)"
  const tint = isDark ? "oklch(0.80 0.18 95 / 0.30)" : "oklch(0.88 0.20 95 / 0.55)"

  // box-shadow: an inset stripe on the LEFT edge + an outer ring. The outer
  // ring is what catches the eye even if the element's background is hidden
  // by descendant painting.
  const startShadow = `inset 4px 0 0 0 ${stripe}, 0 0 0 2px ${stripe}`
  const endShadow = `inset 4px 0 0 0 transparent, 0 0 0 2px transparent`

  el.animate(
    [
      { backgroundColor: tint, boxShadow: startShadow, offset: 0 },
      { backgroundColor: tint, boxShadow: startShadow, offset: 0.4 },
      { backgroundColor: "transparent", boxShadow: endShadow, offset: 1 },
    ],
    { duration: 1000, easing: "ease-out", fill: "none" },
  )
}

