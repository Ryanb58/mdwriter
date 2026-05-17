import { useEffect, useState } from "react"

export function useIsMacTauri(): boolean {
  const [is, setIs] = useState(() => detect())
  useEffect(() => {
    if (is) return
    setIs(detect())
  }, [is])
  return is
}

function detect(): boolean {
  if (typeof window === "undefined") return false
  const inTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window
  if (!inTauri) return false
  const ua = navigator.userAgent || ""
  return /Mac|iPhone|iPad/.test(ua)
}
