import { ArrowClockwise, Download, X, Warning } from "@phosphor-icons/react"
import type { UpdateStatus } from "./useUpdates"

export function UpdateBanner({
  status,
  onInstall,
  onDismiss,
}: {
  status: UpdateStatus
  onInstall: () => void
  onDismiss: () => void
}) {
  if (status.kind === "idle" || status.kind === "checking" || status.kind === "current") {
    return null
  }

  return (
    <div className="fixed bottom-9 right-3 z-40 w-[340px] rounded-lg border border-border-strong bg-elevated text-[13px] overflow-hidden"
         style={{ boxShadow: "0 12px 32px -8px oklch(0 0 0 / 0.55), 0 2px 4px oklch(0 0 0 / 0.3)" }}>
      {status.kind === "available" && (
        <Available version={status.update.version} notes={status.update.body} onInstall={onInstall} onDismiss={onDismiss} />
      )}
      {status.kind === "downloading" && (
        <Downloading bytes={status.bytes} total={status.total} />
      )}
      {status.kind === "ready" && <Ready />}
      {status.kind === "error" && (
        <ErrorState message={status.message} onDismiss={onDismiss} />
      )}
    </div>
  )
}

function Available({
  version, notes, onInstall, onDismiss,
}: {
  version: string
  notes: string | undefined
  onInstall: () => void
  onDismiss: () => void
}) {
  return (
    <div className="p-3">
      <div className="flex items-start gap-2">
        <ArrowClockwise size={14} weight="bold" className="mt-0.5 text-accent flex-none" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-text">Update available</div>
          <div className="text-[12px] text-text-subtle mt-0.5">
            mdwriter <span className="font-mono">{version}</span> is ready to install.
          </div>
          {notes && (
            <div className="text-[12px] text-text-muted mt-2 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
              {notes}
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded text-text-subtle hover:text-text hover:bg-surface transition-colors flex-none"
          aria-label="Dismiss"
        >
          <X size={11} weight="bold" />
        </button>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={onInstall}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-accent text-accent-fg px-3 py-1.5 text-[12px] font-medium hover:opacity-90 transition-opacity"
        >
          <Download size={12} weight="bold" />
          Restart and install
        </button>
        <button
          onClick={onDismiss}
          className="px-3 py-1.5 rounded-md text-[12px] text-text-muted hover:text-text"
        >
          Later
        </button>
      </div>
    </div>
  )
}

function Downloading({ bytes, total }: { bytes: number; total: number | null }) {
  const pct = total ? Math.min(100, Math.round((bytes / total) * 100)) : null
  return (
    <div className="p-3">
      <div className="flex items-start gap-2">
        <Download size={14} weight="bold" className="mt-0.5 text-accent flex-none" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-text">Downloading update…</div>
          <div className="text-[12px] text-text-subtle mt-0.5">
            {pct !== null ? `${pct}% · ${formatBytes(bytes)} / ${formatBytes(total!)}` : formatBytes(bytes)}
          </div>
        </div>
      </div>
      <div className="mt-2 h-1 rounded-full bg-surface overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: pct !== null ? `${pct}%` : "33%" }}
        />
      </div>
    </div>
  )
}

function Ready() {
  return (
    <div className="p-3 flex items-start gap-2">
      <ArrowClockwise size={14} weight="bold" className="mt-0.5 text-accent flex-none animate-spin" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-text">Update ready</div>
        <div className="text-[12px] text-text-subtle mt-0.5">Restarting mdwriter…</div>
      </div>
    </div>
  )
}

function ErrorState({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="p-3">
      <div className="flex items-start gap-2">
        <Warning size={14} weight="bold" className="mt-0.5 text-danger flex-none" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-text">Update check failed</div>
          <div className="text-[12px] text-text-muted mt-0.5 break-words">{message}</div>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded text-text-subtle hover:text-text hover:bg-surface transition-colors flex-none"
          aria-label="Dismiss"
        >
          <X size={11} weight="bold" />
        </button>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  const kb = bytes / 1024
  return `${kb.toFixed(0)} KB`
}
