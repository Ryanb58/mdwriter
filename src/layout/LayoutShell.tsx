import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import {
  PANEL_DIMS,
  isDockedMode,
  isOverlayMode,
  type LayoutMode,
  type PanelState,
} from "./constants"
import { useLayoutMode } from "./useLayoutMode"
import { usePanelStates } from "./usePanelStates"
import { usePanelWidths } from "./usePanelWidths"
import { useReducedMotion } from "./useReducedMotion"
import { LayoutProvider } from "./LayoutContext"
import { SidePanel } from "./SidePanel"
import { Backdrop } from "./Backdrop"
import { Toolbar } from "./Toolbar"
import { ResizeHandle } from "./ResizeHandle"
import { setLayoutController } from "./layoutControl"
import "./layout.css"

type Slot = ReactNode | ((args: { state: PanelState; mode: LayoutMode }) => ReactNode)

function renderSlot(slot: Slot | undefined, state: PanelState, mode: LayoutMode) {
  if (typeof slot === "function") return slot({ state, mode })
  return slot
}

export type LayoutShellProps = {
  toolbarCenter?: ReactNode
  left: Slot
  leftRail?: Slot
  leftLabel?: string
  right: Slot
  rightRail?: Slot
  rightLabel?: string
  children: ReactNode
}

export function LayoutShell({
  toolbarCenter,
  left,
  leftRail,
  leftLabel = "File panel",
  right,
  rightRail,
  rightLabel = "Sidebar",
  children,
}: LayoutShellProps) {
  const { mode, width, ref } = useLayoutMode()
  const { leftState, rightState, setPanelState, togglePanel } = usePanelStates(mode)
  const { leftWidth, rightWidth, setLeftWidth, setRightWidth } = usePanelWidths()
  const reducedMotion = useReducedMotion()
  const [isResizing, setIsResizing] = useState(false)

  const isSheet = mode === "mobile-sheet"
  const overlay = isOverlayMode(mode)
  const anyDrawerOpen = overlay && (leftState === "open" || rightState === "open")

  // Body scroll lock while a mobile sheet is open.
  useEffect(() => {
    if (!isSheet || !anyDrawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [isSheet, anyDrawerOpen])

  // Expose the panel setter to code that sits outside the shell tree.
  useEffect(() => {
    setLayoutController({ setPanelState })
    return () => setLayoutController(null)
  }, [setPanelState])

  const closeDrawers = () => {
    if (leftState === "open") setPanelState("left", "closed")
    if (rightState === "open") setPanelState("right", "closed")
  }

  const widths = computeWidths(mode, leftState, rightState, width, leftWidth, rightWidth)

  const styleVars: CSSProperties = {
    ["--layout-left-grid" as string]: `${widths.leftGrid}px`,
    ["--layout-right-grid" as string]: `${widths.rightGrid}px`,
    ["--layout-left-panel" as string]: `${widths.leftPanel}px`,
    ["--layout-right-panel" as string]: `${widths.rightPanel}px`,
    ["--layout-main-min" as string]: `${PANEL_DIMS.MAIN_MIN}px`,
    ["--layout-toolbar-h" as string]: `${PANEL_DIMS.TOOLBAR}px`,
    ["--layout-rail-w" as string]: `${PANEL_DIMS.RAIL}px`,
  }

  return (
    <LayoutProvider
      value={{ mode, leftState, rightState, setPanelState, togglePanel, reducedMotion }}
    >
      <div
        ref={ref}
        className="layout-shell"
        data-mode={mode}
        data-reduced-motion={reducedMotion}
        data-resizing={isResizing}
        style={styleVars}
      >
        <Toolbar center={toolbarCenter} />
        <div className="layout-body">
          <SidePanel
            id="layout-panel-left"
            side="left"
            state={leftState}
            mode={mode}
            ariaLabel={leftLabel}
            onRequestClose={() => setPanelState("left", overlay ? "closed" : "rail")}
            rail={renderSlot(leftRail, leftState, mode)}
          >
            {renderSlot(left, leftState, mode)}
          </SidePanel>
          <main className="layout-main">{children}</main>
          {isDockedMode(mode) && leftState === "open" && (
            <ResizeHandle
              side="left"
              startWidth={leftWidth}
              setWidth={setLeftWidth}
              min={PANEL_DIMS.LEFT_MIN}
              max={PANEL_DIMS.LEFT_MAX}
              onResizeStart={() => setIsResizing(true)}
              onResizeEnd={() => setIsResizing(false)}
            />
          )}
          {isDockedMode(mode) && rightState === "open" && (
            <ResizeHandle
              side="right"
              startWidth={rightWidth}
              setWidth={setRightWidth}
              min={PANEL_DIMS.RIGHT_MIN}
              max={PANEL_DIMS.RIGHT_MAX}
              onResizeStart={() => setIsResizing(true)}
              onResizeEnd={() => setIsResizing(false)}
            />
          )}
          <SidePanel
            id="layout-panel-right"
            side="right"
            state={rightState}
            mode={mode}
            ariaLabel={rightLabel}
            onRequestClose={() => setPanelState("right", overlay ? "closed" : "rail")}
            rail={renderSlot(rightRail, rightState, mode)}
          >
            {renderSlot(right, rightState, mode)}
          </SidePanel>
          <Backdrop visible={anyDrawerOpen} onClick={closeDrawers} />
        </div>
      </div>
    </LayoutProvider>
  )
}

/**
 * Compute the four width values that drive the CSS:
 *  - leftGrid / rightGrid: grid track widths (0 in overlay so main fills)
 *  - leftPanel / rightPanel: the panel's own intrinsic width (its drawer
 *    width in overlay, its docked width otherwise).
 *
 * Decoupling these is what lets a docked→overlay transition animate
 * smoothly: the grid track shrinks to 0 while the panel itself stays the
 * same visible width, just floating over main instead of pushing it.
 */
function computeWidths(
  mode: LayoutMode,
  left: PanelState,
  right: PanelState,
  viewportW: number,
  leftCustom: number,
  rightCustom: number,
) {
  const leftIntrinsic = left === "rail" ? PANEL_DIMS.RAIL : leftCustom
  const rightIntrinsic = right === "rail" ? PANEL_DIMS.RAIL : rightCustom

  if (mode === "mobile-sheet") {
    // Sheets fill the layout root width. Fall back to a sane default before
    // the ResizeObserver has reported (first paint).
    const w = viewportW > 0 ? viewportW : 360
    return { leftGrid: 0, rightGrid: 0, leftPanel: w, rightPanel: w }
  }

  if (mode === "overlay") {
    // Overlay drawers use their default width (resize handles are docked-only).
    return {
      leftGrid: 0,
      rightGrid: 0,
      leftPanel: PANEL_DIMS.LEFT_DEFAULT,
      rightPanel: PANEL_DIMS.RIGHT_DEFAULT,
    }
  }

  // Docked: grid track and panel intrinsic match so the panel sits flush
  // inside its column. Rail (48 px) and open (default) collapse cleanly.
  return {
    leftGrid: leftIntrinsic,
    rightGrid: rightIntrinsic,
    leftPanel: leftIntrinsic,
    rightPanel: rightIntrinsic,
  }
}

export { useLayout } from "./LayoutContext"
