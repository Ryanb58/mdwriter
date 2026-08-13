import { useState, useCallback, useEffect } from "react"
import { PANEL_DIMS } from "./constants"
import { LAYOUT_WIDTHS_KEY, loadLayoutEntry, saveLayoutEntry } from "./panelStorage"

// Per-window: dragging window B's panel must not resize window A's.
const STORAGE_KEY = LAYOUT_WIDTHS_KEY

type Persisted = { left: number; right: number }

const DEFAULTS: Persisted = {
  left: PANEL_DIMS.LEFT_DEFAULT,
  right: PANEL_DIMS.RIGHT_DEFAULT,
}

function clamp(w: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, w))
}

function load(): Persisted {
  const p = loadLayoutEntry(STORAGE_KEY) as Partial<Persisted> | null
  if (!p) return DEFAULTS
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
}

function save(state: Persisted) {
  saveLayoutEntry(STORAGE_KEY, state)
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
