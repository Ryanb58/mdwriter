import type { PanelSide } from "./constants"

export function ResizeHandle({
  side,
  startWidth,
  setWidth,
  min,
  max,
  onResizeStart,
  onResizeEnd,
}: {
  side: PanelSide
  startWidth: number
  setWidth: (w: number) => void
  min: number
  max: number
  onResizeStart: () => void
  onResizeEnd: () => void
}) {
  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const start = startWidth
    const sign = side === "left" ? 1 : -1

    onResizeStart()
    document.body.style.userSelect = "none"
    document.body.style.cursor = "col-resize"

    const onMove = (me: MouseEvent) => {
      const next = start + sign * (me.clientX - startX)
      setWidth(Math.max(min, Math.min(max, next)))
    }
    const onUp = () => {
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      onResizeEnd()
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return (
    <div
      className="layout-resize-handle"
      data-side={side}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} panel`}
      onMouseDown={onMouseDown}
    />
  )
}
