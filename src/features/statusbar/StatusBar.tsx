import { useStore } from "../../lib/store"
import { CircleNotch, Check } from "@phosphor-icons/react"
import { VaultPicker } from "../vaults/VaultPicker"

function formatTime(ts: number | null): string {
  if (!ts) return ""
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

export function StatusBar() {
  const doc = useStore((s) => s.openDoc)

  return (
    <footer className="flex items-center justify-between border-t border-border bg-surface px-2 py-1 text-[11px] text-text-subtle">
      <div className="flex items-center gap-2 min-w-0">
        <VaultPicker />
      </div>
      <div className="flex items-center gap-2">
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
      </div>
    </footer>
  )
}
