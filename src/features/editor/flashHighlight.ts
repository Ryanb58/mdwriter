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
/**
 * Briefly outline + tint a line/block after a search-result jump so the
 * user's eye lands on the right spot. Holds full intensity for 800ms, then
 * fades over 1200ms via a CSS transition (~2s total visible window).
 *
 * Works by setting inline styles directly on the target element — outlines
 * paint outside the border box at the compositor level, which sidesteps
 * every issue we hit with positioned overlays (ancestor transforms eating
 * `position: fixed`, detached nodes returning zero-size rects, descendants
 * painting over a parent background).
 *
 * Cleanup restores the element's original inline styles even if it was
 * removed from the DOM mid-animation (defensive — read-then-write).
 */
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
    el.style.transition = "outline-color 1200ms ease-out, background-color 1200ms ease-out"
    el.style.outlineColor = "transparent"
    el.style.background = "transparent"
  }, 800)

  window.setTimeout(() => {
    el.style.outline = prevOutline
    el.style.outlineOffset = prevOutlineOffset
    el.style.background = prevBackground
    el.style.transition = prevTransition
  }, 2200)
}

