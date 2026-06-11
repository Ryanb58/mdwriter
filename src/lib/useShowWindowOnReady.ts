import { useEffect } from "react"

/**
 * The main window is created hidden (`visible: false` in tauri.conf.json) so
 * launch never shows an unpainted frame. Reveal it once React has committed
 * its first frame — two nested rAFs after mount land reliably past the first
 * paint. A Rust-side fallback (lib.rs setup) un-hides the window after a few
 * seconds in case the webview never gets this far.
 */
export function useShowWindowOnReady() {
  useEffect(() => {
    let cancelled = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return
        ;(async () => {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window")
            const w = getCurrentWindow()
            await w.show()
            await w.setFocus()
          } catch {
            // Browser dev / e2e — no Tauri window to show.
          }
        })()
      })
    })
    return () => { cancelled = true }
  }, [])
}
