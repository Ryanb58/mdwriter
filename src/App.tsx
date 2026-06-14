import { useEffect } from "react"
import { Robot, SlidersHorizontal } from "@phosphor-icons/react"
import { useStore } from "./lib/store"
import { EmptyFolderState } from "./features/folder/EmptyFolderState"
import { useStartupRestore } from "./features/folder/useStartupRestore"
import { TreePane } from "./features/tree/TreePane"
import { useTreeShortcuts } from "./features/tree/useTreeShortcuts"
import { DndModals } from "./features/tree/DndModals"
import { EditorPane } from "./features/editor/EditorPane"
import { AiPanel } from "./features/ai/AiPanel"
import { PropertiesPane } from "./features/properties/PropertiesPane"
import { useAiSession } from "./features/ai/useAiSession"
import { useChatPersistence } from "./features/ai/useChatPersistence"
import { useAiShortcuts } from "./features/ai/useAiShortcuts"
import { StatusBar } from "./features/statusbar/StatusBar"
import { CommandPalette } from "./features/palette/CommandPalette"
import { SettingsPanel } from "./features/settings/SettingsPanel"
import { ShortcutsModal } from "./features/help/ShortcutsModal"
import { useTheme } from "./features/settings/useTheme"
import { useExternalChanges } from "./features/watcher/useExternalChanges"
import { useUpdates } from "./features/updates/useUpdates"
import { UpdateBanner } from "./features/updates/UpdateBanner"
import { usePasteDiagnostic } from "./lib/pasteDiagnostic"
import { useShowWindowOnReady } from "./lib/useShowWindowOnReady"
import { LayoutShell, useLayout } from "./layout/LayoutShell"
import { Toasts } from "./components/Toasts"
import "./App.css"

export default function App() {
  useShowWindowOnReady()
  useStartupRestore()
  useExternalChanges()
  useTheme()
  useTreeShortcuts()
  usePasteDiagnostic()
  useAiSession()
  useChatPersistence()
  useAiShortcuts()
  const updates = useUpdates()
  const rootPath = useStore((s) => s.rootPath)
  const startupRestoring = useStore((s) => s.startupRestoring)

  // Warm the heavy editor-vendor chunk (BlockNote + markdown rendering)
  // right after first paint so it's ready by the time a document opens.
  // It's lazy-imported (EditorPane / ChatView) to stay off the critical path.
  useEffect(() => {
    void import("./features/editor/BlockEditor")
  }, [])

  if (!rootPath) {
    // While startup restore is still deciding whether a recent vault can be
    // reopened, render a neutral surface instead of flashing "Open a folder"
    // at someone whose vault is about to appear.
    if (startupRestoring) {
      return <div className="h-screen bg-bg" />
    }
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
        <LayoutShell
          leftLabel="File panel"
          rightLabel="Sidebar"
          left={<TreePane />}
          right={<RightPanel />}
          rightRail={<RightRail />}
        >
          <EditorPane />
        </LayoutShell>
        <StatusBar />
      </div>
      <CommandPalette />
      <SettingsPanel />
      <ShortcutsModal />
      <DndModals />
      <UpdateBanner status={updates.status} onInstall={updates.install} onDismiss={updates.dismiss} />
      <Toasts />
    </>
  )
}

// The right pane is tabbed: frontmatter Properties for the open file, or the
// AI Assistant. Each control has one job — the toolbar button shows/hides the
// pane, these tabs switch while it's open, and the rail (below) opens it
// straight to a chosen tab.
function RightPanel() {
  const tab = useStore((s) => s.rightPaneTab)
  const setTab = useStore((s) => s.setRightPaneTab)
  return (
    <div className="flex flex-col h-full min-h-0">
      <div role="tablist" className="flex items-stretch border-b border-border h-9 px-2 flex-none">
        <TabBtn active={tab === "properties"} onClick={() => setTab("properties")}>
          Properties
        </TabBtn>
        <TabBtn active={tab === "ai"} onClick={() => setTab("ai")}>
          Assistant
        </TabBtn>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "properties" ? (
          <div className="h-full overflow-y-auto">
            <PropertiesPane />
          </div>
        ) : (
          <AiPanel />
        )}
      </div>
    </div>
  )
}

// Collapsed-rail affordance. Each button reveals the pane *and* selects its
// tab in one click; the active tab stays highlighted while railed.
function RightRail() {
  const { setPanelState } = useLayout()
  const tab = useStore((s) => s.rightPaneTab)
  const setTab = useStore((s) => s.setRightPaneTab)

  const choose = (next: "properties" | "ai") => {
    setTab(next)
    setPanelState("right", "open")
  }

  return (
    <div className="flex flex-col items-center gap-1 pt-2">
      <RailBtn active={tab === "properties"} onClick={() => choose("properties")} label="Properties">
        <SlidersHorizontal size={16} />
      </RailBtn>
      <RailBtn active={tab === "ai"} onClick={() => choose("ai")} label="Assistant">
        <Robot size={16} />
      </RailBtn>
    </div>
  )
}

function TabBtn({
  active, onClick, children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  // Underline-style tab: the active button's 2px bottom border overlaps the
  // tablist's own border-b (via -mb-px) so it reads as a tab punching through
  // the strip rather than a floating pill.
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "h-9 px-3 -mb-px text-[12px] border-b-2 transition-colors",
        active
          ? "text-text border-text font-medium"
          : "text-text-subtle border-transparent hover:text-text hover:border-border-strong",
      ].join(" ")}
    >
      {children}
    </button>
  )
}

function RailBtn({
  active, onClick, label, children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-active={active ? "true" : undefined}
      className={[
        "w-9 h-9 flex items-center justify-center rounded transition-colors",
        active
          ? "text-text bg-elevated"
          : "text-text-subtle hover:text-text hover:bg-elevated/60",
      ].join(" ")}
    >
      {children}
    </button>
  )
}
