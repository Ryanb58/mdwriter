import { useState, useEffect, useRef } from "react"
import { modeFromWidth, type LayoutMode } from "./constants"

/**
 * Observes a layout root element and reports the current layout mode based
 * on its rendered width. Observing the root (not window) is important so the
 * shell works correctly inside another resizable container.
 */
export function useLayoutMode() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [mode, setMode] = useState<LayoutMode>(() =>
    typeof window !== "undefined" ? modeFromWidth(window.innerWidth) : "docked-wide",
  )
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const apply = (w: number) => {
      setWidth(w)
      setMode((prev) => {
        const next = modeFromWidth(w)
        return prev === next ? prev : next
      })
    }

    apply(el.clientWidth)

    const observer = new ResizeObserver(([entry]) => {
      apply(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { mode, width, ref }
}
