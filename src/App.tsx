import { Robot, Sidebar as SidebarIcon, FolderOpen } from "@phosphor-icons/react"
import { useStore } from "./lib/store"
import { EmptyFolderState } from "./features/folder/EmptyFolderState"
import { useStartupRestore } from "./features/folder/useStartupRestore"
import { TreePane } from "./features/tree/TreePane"
import { useTreeShortcuts } from "./features/tree/useTreeShortcuts"
import { DndModals } from "./features/tree/DndModals"
import { EditorPane } from "./features/editor/EditorPane"
import { AiPanel } from "./features/ai/AiPanel"
import { useAiSession } from "./features/ai/useAiSession"
import { useChatPersistence } from "./features/ai/useChatPersistence"
import { useAiShortcuts } from "./features/ai/useAiShortcuts"
import { StatusBar } from "./features/statusbar/StatusBar"
import { PropertiesPane } from "./features/properties/PropertiesPane"
import { CommandPalette } from "./features/palette/CommandPalette"
import { SettingsPanel } from "./features/settings/SettingsPanel"
import { useTheme } from "./features/settings/useTheme"
import { useExternalChanges } from "./features/watcher/useExternalChanges"
import { useUpdates } from "./features/updates/useUpdates"
import { UpdateBanner } from "./features/updates/UpdateBanner"
import { usePasteDiagnostic } from "./lib/pasteDiagnostic"
import { LayoutShell, useLayout } from "./layout/LayoutShell"
import "./App.css"

export default function App() {
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
        <LayoutShell
          leftLabel="File panel"
          rightLabel="Sidebar"
          left={<TreePane />}
          leftRail={<LeftRail />}
          right={<RightPanel />}
          rightRail={<RightRail />}
        >
          <EditorPane />
        </LayoutShell>
        <StatusBar />
      </div>
      <CommandPalette />
      <SettingsPanel />
      <DndModals />
      <UpdateBanner status={updates.status} onInstall={updates.install} onDismiss={updates.dismiss} />
    </>
  )
}

function LeftRail() {
  const { togglePanel } = useLayout()
  return (
    <button
      type="button"
      onClick={() => togglePanel("left")}
      title="Expand file panel"
      aria-label="Expand file panel"
      className="w-12 h-9 mt-2 mx-auto flex items-center justify-center rounded text-text-subtle hover:text-text hover:bg-elevated transition-colors"
    >
      <FolderOpen size={16} />
    </button>
  )
}

function RightPanel() {
  const tab = useStore((s) => s.rightPaneTab)
  const setTab = useStore((s) => s.setRightPaneTab)
  return (
    <div className="flex flex-col h-full min-h-0">
      <div role="tablist" className="flex items-center border-b border-border h-9 px-1 flex-none">
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
      <RailBtn
        active={tab === "properties"}
        onClick={() => choose("properties")}
        label="Properties"
      >
        <SidebarIcon size={16} />
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
