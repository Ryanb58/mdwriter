import { useEffect } from "react"

// Temporary diagnostic hook: logs the shape of every paste event so we
// can see what the WKWebView surfaces from the system clipboard.
// Remove once image paste reliability is established.
export function usePasteDiagnostic(): void {
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const cd = e.clipboardData
      const items = Array.from(cd?.items ?? []).map((it) => ({
        kind: it.kind,
        type: it.type,
      }))
      const files = Array.from(cd?.files ?? []).map((f) => ({
        name: f.name,
        type: f.type,
        size: f.size,
      }))
      const types = cd ? Array.from(cd.types) : []
      // eslint-disable-next-line no-console
      console.log("[paste-diag] event fired", {
        target: (e.target as HTMLElement | null)?.tagName,
        defaultPrevented: e.defaultPrevented,
        types,
        items,
        files,
      })
    }
    document.addEventListener("paste", onPaste, true)
    return () => document.removeEventListener("paste", onPaste, true)
  }, [])
}
