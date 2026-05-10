import { useStore } from "../../lib/store"
import { useFolderPicker } from "../folder/useFolderPicker"
import { CircleNotch, Check } from "@phosphor-icons/react"

function formatTime(ts: number | null): string {
  if (!ts) return ""
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return p
  return "…/" + parts.slice(-2).join("/")
}

export function StatusBar() {
  const doc = useStore((s) => s.openDoc)
  const root = useStore((s) => s.rootPath)
  const pick = useFolderPicker()

  return (
    <footer className="flex items-center justify-between border-t border-border bg-surface px-3 py-1 text-[11px] text-text-subtle">
      <div className="flex items-center gap-2 min-w-0">
        {doc && doc.dirty && (
          <span className="flex items-center gap-1 text-warning">
            <CircleNotch size={10} className="animate-spin" />
            <span>Saving</span>
          </span>
        )}
        {doc && !doc.dirty && doc.savedAt && (
          <span className="flex items-center gap-1">
            <Check size={10} weight="bold" />
            <span>Saved {formatTime(doc.savedAt)}</span>
          </span>
        )}
        {doc && (
          <span className="font-mono">·</span>
        )}
      </div>
      <button
        onClick={pick}
        className="hover:text-text transition-colors truncate max-w-[480px] text-right font-mono"
        title={root ?? ""}
      >
        {root ? shortPath(root) : ""}
      </button>
    </footer>
  )
}
