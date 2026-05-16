import { useRef, type ReactNode } from "react"
import type { LayoutMode, PanelSide, PanelState } from "./constants"
import { isOverlayMode } from "./constants"
import { useFocusTrap } from "./useFocusTrap"

export function SidePanel({
  id,
  side,
  state,
  mode,
  ariaLabel,
  onRequestClose,
  rail,
  children,
}: {
  id: string
  side: PanelSide
  state: PanelState
  mode: LayoutMode
  ariaLabel: string
  onRequestClose: () => void
  rail?: ReactNode
  children: ReactNode
}) {
  const ref = useRef<HTMLElement | null>(null)

  // Focus trap only applies when the panel is an open overlay drawer.
  const trapActive = isOverlayMode(mode) && state === "open"
  useFocusTrap(ref, trapActive, onRequestClose)

  return (
    <aside
      ref={ref}
      id={id}
      className="layout-panel"
      data-side={side}
      data-state={state}
      role={isOverlayMode(mode) ? "dialog" : "complementary"}
      aria-modal={trapActive ? "true" : undefined}
      aria-label={ariaLabel}
      aria-hidden={state === "closed" ? "true" : undefined}
    >
      <div className="layout-panel-content">{children}</div>
      {rail && <div className="layout-panel-rail">{rail}</div>}
    </aside>
  )
}
