import { useStore } from "./lib/store"
import { EmptyFolderState } from "./features/folder/EmptyFolderState"
import { useStartupRestore } from "./features/folder/useStartupRestore"
import { TreePane } from "./features/tree/TreePane"
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
  if (!rootPath) return <EmptyFolderState />
  return (
    <>
      <div className="flex flex-col h-screen">
        <div className="flex flex-1 min-h-0">
          <div className="w-60 border-r"><TreePane /></div>
          <div className="flex-1"><EditorPane /></div>
          <div className="w-72 border-l overflow-y-auto"><PropertiesPane /></div>
        </div>
        <StatusBar />
      </div>
      <CommandPalette />
    </>
  )
}
