import { useStore } from "../../lib/store"
import { useFolderPicker } from "../folder/useFolderPicker"

function formatTime(ts: number | null): string {
  if (!ts) return "—"
  const d = new Date(ts)
  return d.toLocaleTimeString()
}

export function StatusBar() {
  const doc = useStore((s) => s.openDoc)
  const root = useStore((s) => s.rootPath)
  const pick = useFolderPicker()

  const saveLabel = !doc ? "" : doc.dirty ? "● Unsaved" : doc.savedAt ? `Saved ${formatTime(doc.savedAt)}` : "—"

  return (
    <div className="border-t px-3 py-1 text-xs flex items-center justify-between opacity-70">
      <span>{saveLabel}</span>
      <button onClick={pick} className="hover:underline truncate max-w-md text-right">{root}</button>
    </div>
  )
}
