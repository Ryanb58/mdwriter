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
 * Returns handlers that turn an element into a macOS-correct titlebar drag
 * region for `titleBarStyle: Overlay` (Tauri 2).
 *
 * `data-tauri-drag-region` is unreliable on macOS under Overlay — clicks land
 * but dragging never starts — and the Electron-style `-webkit-app-region: drag`
 * CSS is a no-op in WKWebView. Driving the window directly is the documented
 * workaround:
 *
 * - `onMouseDown` starts a native drag via `startDragging()`.
 * - `onDoubleClick` toggles maximize/zoom, matching the native titlebar's
 *   double-click behavior.
 *
 * Both skip interactive descendants (buttons, inputs, links, `[data-no-drag]`)
 * so controls embedded in the bar keep working and a double-click on, say, the
 * sidebar toggle never zooms the window.
 */
export function useDragRegion() {
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (isInteractiveTarget(e.target)) return
    // A double-click's second mousedown must not start a drag, or the
    // subsequent toggleMaximize fights the drag and the window jitters.
    if (e.detail > 1) return
    e.preventDefault()
    void getCurrentWindow().startDragging().catch(() => {})
  }, [])

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (isInteractiveTarget(e.target)) return
    e.preventDefault()
    void getCurrentWindow().toggleMaximize().catch(() => {})
  }, [])

  return { onMouseDown, onDoubleClick }
}
