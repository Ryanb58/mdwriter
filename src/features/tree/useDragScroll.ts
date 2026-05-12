import { useEffect, useRef } from "react"
import { useDndStore } from "./dndStore"

const EDGE_PX = 36 // size of the auto-scroll zone at each edge
const MAX_SPEED = 14 // pixels per animation frame at the very edge

/**
 * Autoscroll the tree's scroll container when the cursor enters the
 * top/bottom edge zone during a drag. The scroll rate ramps from 0 at
 * the inner boundary of the zone to MAX_SPEED at the outer edge.
 *
 * Returns a ref to attach to the scrollable element plus an
 * `onDragOver` handler that *must* be attached as `onDragOverCapture`
 * so the per-row handlers (which call `stopPropagation` to keep the
 * drop-target highlight scoped) can't block this from firing.
 */
export function useDragScroll() {
  const ref = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const speedRef = useRef(0)
  const active = useDndStore((s) => s.active)

  // When a drag ends (drop or dragend → end()), stop scrolling.
  useEffect(() => {
    if (active) return
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    speedRef.current = 0
  }, [active])

  function tick() {
    const el = ref.current
    if (!el || speedRef.current === 0) {
      rafRef.current = null
      return
    }
    el.scrollTop += speedRef.current
    rafRef.current = requestAnimationFrame(tick)
  }

  function onDragOver(e: React.DragEvent) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const y = e.clientY

    let speed = 0
    if (y < rect.top + EDGE_PX) {
      const dist = Math.max(0, y - rect.top)
      const t = 1 - dist / EDGE_PX
      speed = -Math.ceil(t * MAX_SPEED)
    } else if (y > rect.bottom - EDGE_PX) {
      const dist = Math.max(0, rect.bottom - y)
      const t = 1 - dist / EDGE_PX
      speed = Math.ceil(t * MAX_SPEED)
    }
    speedRef.current = speed
    if (speed !== 0 && rafRef.current == null) {
      rafRef.current = requestAnimationFrame(tick)
    }
  }

  return { ref, onDragOver }
}
