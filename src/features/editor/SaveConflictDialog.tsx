import { useEffect, useState } from "react"
import { useStore } from "../../lib/store"
import { basename } from "../../lib/paths"
import { errorText, showToast } from "../../lib/toast"
import {
  dismissConflictDialog,
  overwriteWithLocalVersion,
  reloadDiscardingLocalChanges,
} from "../../lib/writeDoc"

/**
 * Surfaces a save that was refused because the file changed on disk after this
 * window read it (reference behavior S2.3/S2.4).
 *
 * VS Code's notification offers **Compare** and **Overwrite**. mdwriter has no
 * diff view and building one is out of scope here, so Compare is deliberately
 * absent. In its place both directions of the decision are offered explicitly —
 * keep mine (overwrite disk) or take disk (discard mine) — plus a "keep
 * editing" escape that resolves nothing and leaves the buffer untouched. That
 * preserves the property S2.5 is really about: neither version disappears
 * without the user choosing it.
 */
export function SaveConflictDialog() {
  const conflict = useStore((s) => s.saveConflict)
  const [busy, setBusy] = useState(false)

  const open = Boolean(conflict) && !conflict?.dismissed

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      dismissConflictDialog()
    }
    // Capture phase so this beats the tree's document-level Escape handler,
    // matching the other modals in the app.
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [open])

  // The buttons run IPC. Reset the guard whenever a different conflict opens,
  // so a dialog can never come up already disabled.
  useEffect(() => {
    setBusy(false)
  }, [conflict?.path, conflict?.actualDigest])

  if (!conflict || conflict.dismissed) return null

  async function run(action: () => Promise<void>, failure: string) {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (e) {
      // The buffer is still intact and the conflict is still parked, so the
      // user can pick again.
      showToast(`${failure}: ${errorText(e)}`, { kind: "error" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-conflict-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
    >
      <div className="w-[480px] max-w-[92vw] rounded-lg border border-border-strong bg-elevated shadow-2xl">
        <div
          id="save-conflict-title"
          className="px-5 pt-4 pb-1 text-[15px] font-semibold text-text"
        >
          Couldn’t save “{basename(conflict.path)}”
        </div>
        <div className="px-5 pb-4 text-[13px] text-text-muted">
          The file changed on disk after you opened it — another window or
          another program wrote it. Your edits are still here and nothing has
          been overwritten.
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => dismissConflictDialog()}
            className="rounded-md px-3 py-1.5 text-[13px] text-text-muted hover:bg-base disabled:opacity-50"
          >
            Keep editing
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void run(reloadDiscardingLocalChanges, "Couldn’t reload from disk")
            }}
            className="rounded-md border border-border-strong px-3 py-1.5 text-[13px] text-text hover:bg-base disabled:opacity-50"
          >
            Discard mine, reload
          </button>
          <button
            type="button"
            autoFocus
            disabled={busy}
            onClick={() => {
              void run(overwriteWithLocalVersion, "Couldn’t overwrite the file")
            }}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            Overwrite with mine
          </button>
        </div>
      </div>
    </div>
  )
}
