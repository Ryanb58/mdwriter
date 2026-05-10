import { useFolderPicker } from "./useFolderPicker"

export function EmptyFolderState() {
  const pick = useFolderPicker()
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-xl font-semibold mb-2">Welcome to mdwriter</h1>
        <p className="text-sm opacity-70 mb-6">Choose a folder of markdown files to begin.</p>
        <button onClick={pick} className="px-4 py-2 rounded bg-blue-600 text-white">Open folder</button>
      </div>
    </div>
  )
}
