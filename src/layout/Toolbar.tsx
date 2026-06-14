import type { ReactNode } from "react"
import { SidebarSimple, ArrowsInLineHorizontal } from "@phosphor-icons/react"
import { useStore } from "../lib/store"
import { useLayout } from "./LayoutContext"
import { useIsMacTauri } from "./useIsMacTauri"
import { useDragRegion } from "./useDragRegion"
import { isOverlayMode } from "./constants"

export function Toolbar({ center }: { center?: ReactNode }) {
  const { leftState, rightState, mode, togglePanel, setPanelState } = useLayout()
  const leftOpen = leftState === "open"
  // The right pane is tabbed (Properties / Assistant), so this toggle just
  // shows or hides the pane — tab selection lives in the pane and its rail.
  const rightOpen = rightState === "open"
  const isMacTauri = useIsMacTauri()
  const { onMouseDown, onDoubleClick } = useDragRegion()

  function toggleRight() {
    if (rightOpen) {
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
        <FocusModeButton />
        <button
          type="button"
          className="layout-toolbar-btn"
          aria-expanded={rightOpen}
          aria-controls="layout-panel-right"
          aria-label={rightOpen ? "Hide sidebar" : "Show sidebar"}
          title={rightOpen ? "Hide sidebar" : "Show sidebar"}
          onClick={toggleRight}
          data-active={rightOpen ? "true" : undefined}
        >
          <SidebarSimple size={16} weight={rightOpen ? "fill" : "regular"} className="-scale-x-100" />
        </button>
      </div>
    </div>
  )
}

function FocusModeButton() {
  const focusMode = useStore((s) => s.focusMode)
  const setFocusMode = useStore((s) => s.setFocusMode)
  return (
    <button
      type="button"
      className="layout-toolbar-btn"
      aria-pressed={focusMode}
      aria-label={focusMode ? "Exit focus mode" : "Focus mode"}
      title={focusMode ? "Exit focus mode (⌘⇧↩)" : "Focus mode (⌘⇧↩)"}
      onClick={() => setFocusMode(!focusMode)}
      data-active={focusMode ? "true" : undefined}
    >
      <ArrowsInLineHorizontal size={16} weight={focusMode ? "fill" : "regular"} />
    </button>
  )
}
