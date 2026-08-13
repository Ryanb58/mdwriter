import { useEffect } from "react"
import { useStore } from "../../lib/store"
import {
  scheduleOpenDocSave,
  flushOpenDocSave,
} from "../../lib/writeDoc"
import { ipc } from "../../lib/ipc"

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
  // closing right after the last keystroke silently drops it. Registering this
  // listener at all makes Tauri prevent the close for this window, so the
  // handler owns finishing it: flush, then hand back to Rust.
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
            // Rust finishes the close: it destroys this window (which is what
            // fires `WindowEvent::Destroyed` and so releases this window's file
            // watcher and its claim on its vault), except for the last window on
            // macOS, which it hides so the app stays running and reopenable.
            // Deciding here is what broke it before: only the backend can count
            // the live windows, and hiding unconditionally on macOS meant no
            // window was ever destroyed and no closed window ever cleaned up.
            await ipc.closeWindow()
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
