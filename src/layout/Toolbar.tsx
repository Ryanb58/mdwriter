import type { ReactNode } from "react"
import { SidebarSimple, Robot } from "@phosphor-icons/react"
import { useLayout } from "./LayoutContext"
import { useIsMacTauri } from "./useIsMacTauri"
import { useDragRegion } from "./useDragRegion"
import { isOverlayMode } from "./constants"

export function Toolbar({ center }: { center?: ReactNode }) {
  const { leftState, rightState, mode, togglePanel, setPanelState } = useLayout()
  const leftOpen = leftState === "open"
  // The right pane hosts only the assistant, so one toggle covers it — the
  // old separate "sidebar" chevron duplicated this exact action.
  const aiActive = rightState === "open"
  const isMacTauri = useIsMacTauri()
  const { onMouseDown, onDoubleClick } = useDragRegion()

  function toggleAi() {
    if (aiActive) {
      setPanelState("right", isOverlayMode(mode) ? "closed" : "rail")
      return
    }
    setPanelState("right", "open")
  }

  return (
    <div
      className="layout-toolbar"
      role="toolbar"
      aria-label="Layout controls"
      data-os={isMacTauri ? "mac" : undefined}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    >
      <div className="layout-toolbar-group">
        <button
          type="button"
          className="layout-toolbar-btn"
          aria-expanded={leftOpen}
          aria-controls="layout-panel-left"
          aria-label={leftOpen ? "Collapse file panel" : "Expand file panel"}
          title={leftOpen ? "Collapse file panel" : "Expand file panel"}
          onClick={() => togglePanel("left")}
        >
          <SidebarSimple size={16} weight={leftOpen ? "fill" : "regular"} />
        </button>
      </div>
      <div className="flex-1 min-w-0 px-3 truncate text-[12px] text-text-subtle">
        {center}
      </div>
      <div className="layout-toolbar-group">
        <button
          type="button"
          className="layout-toolbar-btn"
          aria-expanded={aiActive}
          aria-controls="layout-panel-right"
          aria-label={aiActive ? "Hide assistant" : "Show assistant"}
          title={aiActive ? "Hide assistant" : "Show assistant"}
          onClick={toggleAi}
          data-active={aiActive ? "true" : undefined}
        >
          <Robot size={16} weight={aiActive ? "fill" : "regular"} />
        </button>
      </div>
    </div>
  )
}
