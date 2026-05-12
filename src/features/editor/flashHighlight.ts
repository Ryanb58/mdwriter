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

  const rect = el.getBoundingClientRect()
  const cs = typeof window !== "undefined" ? window.getComputedStyle(el) : null
  console.log("[flashHighlight] rect:", rect, {
    position: cs?.position,
    display: cs?.display,
    overflow: cs?.overflow,
    zIndex: cs?.zIndex,
    visibility: cs?.visibility,
  })

  // Belt-and-suspenders: apply styles to BOTH the element itself (outline
  // + background) AND a child overlay. If anything in this DOM tree is
  // hiding one approach, the other should still come through.

  // 1) Inline outline + background on the target. Outlines paint outside the
  //    border box and are drawn at the compositor level — even children with
  //    their own backgrounds can't hide them.
  const prevOutline = el.style.outline
  const prevOutlineOffset = el.style.outlineOffset
  const prevBackground = el.style.background
  el.style.outline = "4px solid #f59e0b"
  el.style.outlineOffset = "0px"
  el.style.background = "rgba(252, 211, 77, 0.55)"

  // 2) Also append an absolute-positioned overlay as a *direct* sibling-in
  //    -body so document.body's stacking context (which has no transforms)
  //    is the containing block. Position via document coordinates.
  const overlay = document.createElement("div")
  overlay.id = "search-jump-flash-overlay"
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
    "transition: opacity 1200ms ease-out",
  ].join("; ")
  document.body.appendChild(overlay)
  console.log("[flashHighlight] applied outline+bg to el and appended body overlay")

  // Hold full visibility ~800ms, then fade ~1200ms = ~2s total.
  window.setTimeout(() => {
    overlay.style.opacity = "0"
    el.style.transition = "outline-color 1200ms ease-out, background-color 1200ms ease-out"
    el.style.outlineColor = "transparent"
    el.style.background = "transparent"
    console.log("[flashHighlight] fading")
  }, 800)

  const cleanup = () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
    el.style.outline = prevOutline
    el.style.outlineOffset = prevOutlineOffset
    el.style.background = prevBackground
    el.style.transition = ""
    console.log("[flashHighlight] cleaned up")
  }
  window.setTimeout(cleanup, 2200)
}

