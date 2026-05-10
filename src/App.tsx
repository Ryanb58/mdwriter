import { useStore } from "./lib/store"
import { EmptyFolderState } from "./features/folder/EmptyFolderState"
import { useStartupRestore } from "./features/folder/useStartupRestore"
import "./App.css"

export default function App() {
  useStartupRestore()
  const rootPath = useStore((s) => s.rootPath)
  if (!rootPath) return <EmptyFolderState />
  return (
    <div className="flex h-screen">
      <div className="w-60 border-r">tree</div>
      <div className="flex-1">editor</div>
      <div className="w-72 border-l">properties</div>
    </div>
  )
}
