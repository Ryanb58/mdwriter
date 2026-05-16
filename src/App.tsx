import { useRef, useEffect } from "react"
import { X } from "@phosphor-icons/react"
import { useStore } from "./lib/store"
import { EmptyFolderState } from "./features/folder/EmptyFolderState"
import { useStartupRestore } from "./features/folder/useStartupRestore"
import { TreePane } from "./features/tree/TreePane"
import { useTreeShortcuts } from "./features/tree/useTreeShortcuts"
import { DndModals } from "./features/tree/DndModals"
import { EditorPane } from "./features/editor/EditorPane"
import { AiPanel } from "./features/ai/AiPanel"
import { useAiSession } from "./features/ai/useAiSession"
import { StatusBar } from "./features/statusbar/StatusBar"
import { PropertiesPane } from "./features/properties/PropertiesPane"
import { CommandPalette } from "./features/palette/CommandPalette"
import { SettingsPanel } from "./features/settings/SettingsPanel"
import { useTheme } from "./features/settings/useTheme"
import { useExternalChanges } from "./features/watcher/useExternalChanges"
import { useUpdates } from "./features/updates/useUpdates"
import { UpdateBanner } from "./features/updates/UpdateBanner"
import { usePasteDiagnostic } from "./lib/pasteDiagnostic"
import "./App.css"

export default function App() {
  useStartupRestore()
  useExternalChanges()
  useTheme()
  useTreeShortcuts()
  usePasteDiagnostic()
  useAiSession()
  const updates = useUpdates()
  const rootPath = useStore((s) => s.rootPath)
  const rightPane = useStore((s) => s.rightPane)
  const setRightPane = useStore((s) => s.setRightPane)
  const leftPaneCollapsed = useStore((s) => s.leftPaneCollapsed)
  const setLeftPaneCollapsed = useStore((s) => s.setLeftPaneCollapsed)
  const leftPaneWidth = useStore((s) => s.leftPaneWidth)
  const rightPaneWidth = useStore((s) => s.rightPaneWidth)
  const setLeftPaneWidth = useStore((s) => s.setLeftPaneWidth)
  const setRightPaneWidth = useStore((s) => s.setRightPaneWidth)

  // Refs so the ResizeObserver callback sees current values without re-subscribing.
  const containerRef = useRef<HTMLDivElement>(null)
  const autoCollapsedRef = useRef({ left: false, right: false })
  const leftCollapsedRef = useRef(leftPaneCollapsed)
  leftCollapsedRef.current = leftPaneCollapsed
  const rightPaneRef = useRef(rightPane)
  rightPaneRef.current = rightPane
  const lastRightPaneTabRef = useRef<"properties" | "ai">("properties")
  if (rightPane !== null) lastRightPaneTabRef.current = rightPane

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w < 560) {
        if (!leftCollapsedRef.current) {
          setLeftPaneCollapsed(true)
          autoCollapsedRef.current.left = true
        }
        if (rightPaneRef.current !== null) {
          setRightPane(null)
          autoCollapsedRef.current.right = true
        }
      } else if (w >= 680) {
        if (autoCollapsedRef.current.left) {
          setLeftPaneCollapsed(false)
          autoCollapsedRef.current.left = false
        }
        if (autoCollapsedRef.current.right) {
          setRightPane(lastRightPaneTabRef.current)
          autoCollapsedRef.current.right = false
        }
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [setLeftPaneCollapsed, setRightPane])

  if (!rootPath) {
    return (
      <>
        <EmptyFolderState />
        <SettingsPanel />
        <DndModals />
        <UpdateBanner status={updates.status} onInstall={updates.install} onDismiss={updates.dismiss} />
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col h-screen bg-bg text-text">
        <div ref={containerRef} className="flex flex-1 min-h-0">
          {!leftPaneCollapsed && (
            <aside className="flex-none bg-surface overflow-hidden" style={{ width: leftPaneWidth }}>
              <TreePane />
            </aside>
          )}
          {!leftPaneCollapsed && (
            <ResizeHandle
              onMouseDown={(e) => startResize(e, leftPaneWidth, setLeftPaneWidth, 160, 520, 1)}
            />
          )}
          <main className="flex-1 min-w-0 flex flex-col">
            <EditorPane />
          </main>
          {rightPane && (
            <>
            <ResizeHandle
              onMouseDown={(e) => startResize(e, rightPaneWidth, setRightPaneWidth, 200, 640, -1)}
            />
            <aside className="flex-none bg-surface flex flex-col min-h-0" style={{ width: rightPaneWidth }}>
              <div className="flex items-center border-b border-border h-9 px-1 flex-none">
                <RightPaneTabBtn active={rightPane === "properties"} onClick={() => setRightPane("properties")}>
                  Properties
                </RightPaneTabBtn>
                <RightPaneTabBtn active={rightPane === "ai"} onClick={() => setRightPane("ai")}>
                  Assistant
                </RightPaneTabBtn>
                <button
                  onClick={() => setRightPane(null)}
                  className="ml-auto mr-1 p-1 rounded text-text-subtle hover:text-text hover:bg-elevated transition-colors"
                  title="Close panel"
                  aria-label="Close panel"
                >
                  <X size={12} weight="bold" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {rightPane === "properties" ? (
                  <div className="h-full overflow-y-auto">
                    <PropertiesPane />
                  </div>
                ) : (
                  <AiPanel />
                )}
              </div>
            </aside>
            </>
          )}
        </div>
        <StatusBar />
      </div>
      <CommandPalette />
      <SettingsPanel />
      <DndModals />
      <UpdateBanner status={updates.status} onInstall={updates.install} onDismiss={updates.dismiss} />
    </>
  )
}

function startResize(
  e: React.MouseEvent,
  startWidth: number,
  setter: (w: number) => void,
  min: number,
  max: number,
  sign: 1 | -1,
) {
  e.preventDefault()
  const startX = e.clientX
  document.body.style.userSelect = "none"
  document.body.style.cursor = "col-resize"
  const onMove = (me: MouseEvent) =>
    setter(Math.max(min, Math.min(max, startWidth + sign * (me.clientX - startX))))
  const onUp = () => {
    document.body.style.userSelect = ""
    document.body.style.cursor = ""
    document.removeEventListener("mousemove", onMove)
    document.removeEventListener("mouseup", onUp)
  }
  document.addEventListener("mousemove", onMove)
  document.addEventListener("mouseup", onUp)
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="w-[4px] flex-none cursor-col-resize bg-border hover:bg-accent/50 transition-colors duration-150"
      onMouseDown={onMouseDown}
    />
  )
}

function RightPaneTabBtn({
  active, onClick, children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "h-7 px-2.5 text-[12px] rounded transition-colors",
        active
          ? "text-text bg-elevated"
          : "text-text-subtle hover:text-text hover:bg-elevated/60",
      ].join(" ")}
    >
      {children}
    </button>
  )
}

