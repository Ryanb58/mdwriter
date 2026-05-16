import type { ReactNode } from "react"
import { SidebarSimple, Sidebar } from "@phosphor-icons/react"
import { useLayout } from "./LayoutContext"

export function Toolbar({ center }: { center?: ReactNode }) {
  const { leftState, rightState, togglePanel } = useLayout()
  const leftOpen = leftState === "open"
  const rightOpen = rightState === "open"

  return (
    <div className="layout-toolbar" role="toolbar" aria-label="Layout controls">
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
