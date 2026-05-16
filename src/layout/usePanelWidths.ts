import { useState, useCallback, useEffect } from "react"
import { PANEL_DIMS } from "./constants"

const STORAGE_KEY = "mdwriter:layout-widths-v1"

type Persisted = { left: number; right: number }

const DEFAULTS: Persisted = {
  left: PANEL_DIMS.LEFT_DEFAULT,
  right: PANEL_DIMS.RIGHT_DEFAULT,
}

function clamp(w: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, w))
}

function load(): Persisted {
  if (typeof window === "undefined") return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw)
    return {
      left:
        typeof p?.left === "number"
          ? clamp(p.left, PANEL_DIMS.LEFT_MIN, PANEL_DIMS.LEFT_MAX)
          : DEFAULTS.left,
      right:
        typeof p?.right === "number"
          ? clamp(p.right, PANEL_DIMS.RIGHT_MIN, PANEL_DIMS.RIGHT_MAX)
          : DEFAULTS.right,
    }
  } catch {
    return DEFAULTS
  }
}

function save(state: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export function usePanelWidths() {
  const [state, setState] = useState<Persisted>(load)

  useEffect(() => {
    save(state)
  }, [state])

  const setLeftWidth = useCallback((w: number) => {
    setState((s) => ({ ...s, left: clamp(w, PANEL_DIMS.LEFT_MIN, PANEL_DIMS.LEFT_MAX) }))
  }, [])

  const setRightWidth = useCallback((w: number) => {
    setState((s) => ({ ...s, right: clamp(w, PANEL_DIMS.RIGHT_MIN, PANEL_DIMS.RIGHT_MAX) }))
  }, [])

  return {
    leftWidth: state.left,
    rightWidth: state.right,
    setLeftWidth,
    setRightWidth,
  }
}
