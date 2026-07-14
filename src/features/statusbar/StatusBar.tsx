import { useStore } from "../../lib/store"
import { CircleNotch, Check, Gear } from "@phosphor-icons/react"
import { VaultPicker } from "../vaults/VaultPicker"
import { AgentPicker } from "../ai/AgentPicker"
import { retryOpenDocSave } from "../../lib/writeDoc"

function formatTime(ts: number | null): string {
  if (!ts) return ""
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

export function StatusBar() {
  const doc = useStore((s) => s.openDoc)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)

  return (
    <footer className="flex items-center justify-between border-t border-border bg-surface px-3 py-1 text-[11px] text-text-subtle">
      <div className="flex items-center gap-2 min-w-0">
        <VaultPicker />
      </div>
      <div className="flex items-center gap-3">
        {doc?.saveStatus === "queued" && (
          <span className="text-warning">Unsaved</span>
        )}
        {doc?.saveStatus === "saving" && (
          <span className="flex items-center gap-1 text-warning">
            <CircleNotch size={10} className="animate-spin" data-testid="save-spinner" />
            <span>Saving…</span>
          </span>
        )}
        {doc?.saveStatus === "error" && (
          <span className="flex items-center gap-1.5 text-danger" title={doc.saveError ?? undefined}>
            <span>Save failed</span>
            <button
              type="button"
              aria-label="Retry save"
              onClick={() => { void retryOpenDocSave().catch(() => {}) }}
              className="rounded border border-danger/30 px-1.5 py-0.5 font-medium hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger"
            >
              Retry
            </button>
          </span>
        )}
        {doc?.saveStatus === "clean" && doc.savedAt && (
          <span className="flex items-center gap-1">
            <Check size={10} weight="bold" />
            <span>Saved {formatTime(doc.savedAt)}</span>
          </span>
        )}
        <AgentPicker placement="above" variant="compact" />
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated transition-colors"
          title="Settings (⌘,)"
          aria-label="Settings"
        >
          <Gear size={12} />
        </button>
      </div>
    </footer>
  )
}
