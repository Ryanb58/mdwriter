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
        <div className="flex flex-1 min-h-0">
          <aside className="w-[240px] flex-none border-r border-border bg-surface">
            <TreePane />
          </aside>
          <main className="flex-1 min-w-0 flex flex-col">
            <EditorPane />
          </main>
          {rightPane && (
            <aside className="w-[340px] flex-none border-l border-border bg-surface flex flex-col min-h-0">
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

