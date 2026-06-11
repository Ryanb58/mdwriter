import { useEffect } from "react"
import { useStore } from "../../lib/store"
import {
  scheduleOpenDocSave,
  flushPendingOpenDocSave,
  cancelPendingOpenDocSave,
  writeOpenDocNow,
} from "../../lib/writeDoc"

/**
 * Back-compat re-export so existing imports (watcher, renameOpenDoc)
 * keep working. New code should import directly from `lib/writeDoc`.
 */
export function cancelPendingDocSave() {
  cancelPendingOpenDocSave()
}

export function useAutoSave() {
  const doc = useStore((s) => s.openDoc)

  useEffect(() => {
    if (!doc || !doc.dirty) return
    scheduleOpenDocSave(doc.path, doc.text)
  }, [doc?.dirty, doc?.text, doc?.path])

  // flush on path change / unmount
  useEffect(() => {
    return () => { flushPendingOpenDocSave() }
  }, [doc?.path])

  // Flush on window close. The autosave debounce is 500ms — without this,
  // quitting right after the last keystroke silently drops it. Tauri defers
  // the close until async close-requested handlers settle, so awaiting the
  // write here guarantees the bytes are on disk before the process exits.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    ;(async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        const stop = await getCurrentWindow().onCloseRequested(async () => {
          const cur = useStore.getState().openDoc
          if (!cur?.dirty) return
          try {
            await writeOpenDocNow(cur.path, cur.text)
          } catch (e) {
            console.error("flush-on-close failed", e)
          }
        })
        if (disposed) stop()
        else unlisten = stop
      } catch {
        // Browser dev / e2e — no Tauri window.
      }
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])
}
