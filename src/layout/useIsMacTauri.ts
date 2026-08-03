import { useEffect, useState } from "react"

export function useIsMacTauri(): boolean {
  const [is, setIs] = useState(() => isMacTauri())
  useEffect(() => {
    if (is) return
    setIs(isMacTauri())
  }, [is])
  return is
}

export function isMacTauri(): boolean {
  if (typeof window === "undefined") return false
  const inTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window
  if (!inTauri) return false
  const ua = navigator.userAgent || ""
  return /Mac|iPhone|iPad/.test(ua)
}
