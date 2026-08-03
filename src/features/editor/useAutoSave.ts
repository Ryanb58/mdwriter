import { useEffect } from "react"
import { useStore } from "../../lib/store"
import {
  scheduleOpenDocSave,
  flushOpenDocSave,
} from "../../lib/writeDoc"
import { isMacTauri } from "../../layout/useIsMacTauri"

export function useAutoSave() {
  const doc = useStore((s) => s.openDoc)

  useEffect(() => {
    if (!doc || !doc.dirty) return
    scheduleOpenDocSave({ path: doc.path, text: doc.text })
  }, [doc?.dirty, doc?.text, doc?.path])

  // flush on path change / unmount
  useEffect(() => {
    const path = doc?.path
    if (!path) return
    return () => {
      void flushOpenDocSave(path).catch(() => {
        // The coordinator already records and surfaces the persistent error.
      })
    }
  }, [doc?.path])

  // Flush on window close. The autosave debounce is 500ms — without this,
  // closing right after the last keystroke silently drops it. Tauri defers
  // the close until async close-requested handlers settle, so awaiting the
  // write guarantees the bytes are on disk before hiding or destroying.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    ;(async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        const window = getCurrentWindow()
        const stop = await window.onCloseRequested(async (event) => {
          event.preventDefault()
          try {
            await flushOpenDocSave()
            if (isMacTauri()) {
              // A macOS app normally stays alive when its final window
              // closes. Keep this window reusable so Dock Reopen and the
              // Window menu can reveal it without reconstructing app state.
              await window.hide()
            } else {
              // `close()` would emit another close-requested event. Destroying
              // after a successful flush completes the already-approved close.
              await window.destroy()
            }
          } catch (e) {
            console.error("safe window close failed", e)
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
