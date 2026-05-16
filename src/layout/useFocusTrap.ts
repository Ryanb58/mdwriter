import { useEffect, type RefObject } from "react"

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
  )
}

/**
 * Traps Tab focus inside `ref` while `active` is true.
 *
 * When activated, focus moves to the first focusable element. On deactivation,
 * focus returns to whichever element had focus before activation. Escape calls
 * `onEscape` (callers wire this up to close the overlay).
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
) {
  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (!root) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    // Defer to allow the slide-in transition's first frame to land before
    // moving focus — avoids the first focusable element jumping into view.
    const focusTimer = window.setTimeout(() => {
      const focusables = focusableWithin(root)
      focusables[0]?.focus()
    }, 0)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onEscape?.()
        return
      }
      if (e.key !== "Tab") return
      const focusables = focusableWithin(root)
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const current = document.activeElement as HTMLElement | null
      if (e.shiftKey && current === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && current === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener("keydown", onKeyDown)
      // Return focus to whatever triggered the overlay.
      previouslyFocused?.focus?.()
    }
  }, [active, ref, onEscape])
}
