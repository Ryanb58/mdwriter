/**
 * Briefly paint a fading background on the given element — used after a
 * search-result jump to draw the user's eye to the target line/block. We
 * toggle a class instead of overlaying a positioned div because BlockNote's
 * Mantine tree (and other rich-text editors) frequently contain ancestors
 * with `transform` / `filter` / `contain`, which break `position: fixed`.
 *
 * Styling lives in `.search-flash-active` in App.css.
 */
export function flashHighlight(el: HTMLElement | null | undefined) {
  if (!el) return
  // Restart the animation if it's already running so a rapid second hit on
  // the same element still flashes visibly.
  el.classList.remove("search-flash-active")
  // Force a reflow so the browser sees the class removal before re-adding.
  void el.offsetWidth
  el.classList.add("search-flash-active")
  const clear = () => el.classList.remove("search-flash-active")
  el.addEventListener("animationend", clear, { once: true })
  // Defensive fallback — if animationend doesn't fire (interrupted scroll,
  // browser quirk), clear the class anyway after the fade window.
  window.setTimeout(clear, 800)
}

