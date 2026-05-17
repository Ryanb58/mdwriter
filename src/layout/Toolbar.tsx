import type { ReactNode } from "react"
import { SidebarSimple, Sidebar, Robot } from "@phosphor-icons/react"
import { useLayout } from "./LayoutContext"
import { useIsMacTauri } from "./useIsMacTauri"
import { useDragRegion } from "./useDragRegion"
import { useStore } from "../lib/store"
import { isOverlayMode } from "./constants"

export function Toolbar({ center }: { center?: ReactNode }) {
  const { leftState, rightState, mode, togglePanel, setPanelState } = useLayout()
  const leftOpen = leftState === "open"
  const rightOpen = rightState === "open"
  const rightTab = useStore((s) => s.rightPaneTab)
  const setRightTab = useStore((s) => s.setRightPaneTab)
  const aiActive = rightOpen && rightTab === "ai"
  const isMacTauri = useIsMacTauri()
  const { onMouseDown } = useDragRegion()

  function toggleAi() {
    if (aiActive) {
      setPanelState("right", isOverlayMode(mode) ? "closed" : "rail")
      return
    }
    setRightTab("ai")
    setPanelState("right", "open")
  }

  return (
    <div
      className="layout-toolbar"
      role="toolbar"
      aria-label="Layout controls"
      data-os={isMacTauri ? "mac" : undefined}
      onMouseDown={onMouseDown}
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
          aria-pressed={aiActive}
          aria-label={aiActive ? "Hide assistant" : "Show assistant"}
          title={aiActive ? "Hide assistant" : "Show assistant"}
          onClick={toggleAi}
          data-active={aiActive ? "true" : undefined}
        >
          <Robot size={16} weight={aiActive ? "fill" : "regular"} />
        </button>
        <button
          type="button"
          className="layout-toolbar-btn"
          aria-expanded={rightOpen}
          aria-controls="layout-panel-right"
          aria-label={rightOpen ? "Collapse sidebar" : "Expand sidebar"}
          title={rightOpen ? "Collapse sidebar" : "Expand sidebar"}
          onClick={() => togglePanel("right")}
        >
          <Sidebar size={16} weight={rightOpen ? "fill" : "regular"} />
        </button>
      </div>
    </div>
  )
}
