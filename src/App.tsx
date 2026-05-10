import { useStore } from "./lib/store"
import { EmptyFolderState } from "./features/folder/EmptyFolderState"
import { useStartupRestore } from "./features/folder/useStartupRestore"
import { TreePane } from "./features/tree/TreePane"
import { VaultPicker } from "./features/vaults/VaultPicker"
import { EditorPane } from "./features/editor/EditorPane"
import { StatusBar } from "./features/statusbar/StatusBar"
import { PropertiesPane } from "./features/properties/PropertiesPane"
import { CommandPalette } from "./features/palette/CommandPalette"
import { useExternalChanges } from "./features/watcher/useExternalChanges"
import "./App.css"

export default function App() {
  useStartupRestore()
  useExternalChanges()
  const rootPath = useStore((s) => s.rootPath)
  const propertiesVisible = useStore((s) => s.propertiesVisible)

  if (!rootPath) return <EmptyFolderState />

  return (
    <>
      <div className="flex flex-col h-screen bg-bg text-text">
        <div className="flex flex-1 min-h-0">
          <aside className="w-[240px] flex-none border-r border-border bg-surface flex flex-col">
            <div className="flex-1 min-h-0">
              <TreePane />
            </div>
            <VaultPicker />
          </aside>
          <main className="flex-1 min-w-0 flex flex-col">
            <EditorPane />
          </main>
          {propertiesVisible && (
            <aside className="w-[280px] flex-none border-l border-border bg-surface overflow-y-auto">
              <PropertiesPane />
            </aside>
          )}
        </div>
        <StatusBar />
      </div>
      <CommandPalette />
    </>
  )
}
