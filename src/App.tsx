import { useStore } from "./lib/store"
import { EmptyFolderState } from "./features/folder/EmptyFolderState"
import { useStartupRestore } from "./features/folder/useStartupRestore"
import { TreePane } from "./features/tree/TreePane"
import { useTreeShortcuts } from "./features/tree/useTreeShortcuts"
import { EditorPane } from "./features/editor/EditorPane"
import { AiPanel } from "./features/ai/AiPanel"
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
  const updates = useUpdates()
  const rootPath = useStore((s) => s.rootPath)
  const propertiesVisible = useStore((s) => s.propertiesVisible)
  const aiPanelVisible = useStore((s) => s.aiPanelVisible)

  if (!rootPath) {
    return (
      <>
        <EmptyFolderState />
        <SettingsPanel />
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
          {propertiesVisible && (
            <aside className="w-[280px] flex-none border-l border-border bg-surface overflow-y-auto">
              <PropertiesPane />
            </aside>
          )}
          {aiPanelVisible && (
            <aside className="w-[360px] flex-none border-l border-border bg-surface">
              <AiPanel />
            </aside>
          )}
        </div>
        <StatusBar />
      </div>
      <CommandPalette />
      <SettingsPanel />
      <UpdateBanner status={updates.status} onInstall={updates.install} onDismiss={updates.dismiss} />
    </>
  )
}
