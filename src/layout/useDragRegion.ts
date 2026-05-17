import { useCallback } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"

const NO_DRAG_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "a",
  "[data-no-drag]",
].join(", ")

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(NO_DRAG_SELECTOR) !== null
}

/**
 * Returns a mousedown handler that triggers Tauri's startDragging().
 * `data-tauri-drag-region` is unreliable on macOS when combined with
 * `titleBarStyle: Overlay` (Tauri 2) — clicks land but dragging never
 * starts. Calling `startDragging()` directly is the documented workaround.
 */
export function useDragRegion() {
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (isInteractiveTarget(e.target)) return
    e.preventDefault()
    void getCurrentWindow().startDragging().catch(() => {})
  }, [])

  return { onMouseDown }
}
