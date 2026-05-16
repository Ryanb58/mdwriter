import { useState, useEffect, useCallback } from "react"
import {
  familyForMode,
  isOverlayMode,
  type LayoutMode,
  type PanelFamily,
  type PanelSide,
  type PanelState,
} from "./constants"

type FamilyState = { left: PanelState; right: PanelState }
type PersistedState = { docked: FamilyState; overlay: FamilyState }

const STORAGE_KEY = "mdwriter:layout-panels-v1"

const DEFAULTS: PersistedState = {
  docked: { left: "open", right: "open" },
  overlay: { left: "closed", right: "closed" },
}

function isValidDocked(s: unknown): s is "open" | "rail" {
  return s === "open" || s === "rail"
}
function isValidOverlay(s: unknown): s is "open" | "closed" {
  return s === "open" || s === "closed"
}

function loadState(): PersistedState {
  if (typeof window === "undefined") return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw)
    return {
      docked: {
        left: isValidDocked(p?.docked?.left) ? p.docked.left : DEFAULTS.docked.left,
        right: isValidDocked(p?.docked?.right) ? p.docked.right : DEFAULTS.docked.right,
      },
      overlay: {
        left: isValidOverlay(p?.overlay?.left) ? p.overlay.left : DEFAULTS.overlay.left,
        right: isValidOverlay(p?.overlay?.right) ? p.overlay.right : DEFAULTS.overlay.right,
      },
    }
  } catch {
    return DEFAULTS
  }
}

function saveState(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Apply per-mode constraints to derive what each panel should actually
 * display, given a persisted state. The "most-recently-expanded wins" rule
 * decides which panel keeps its full-width state when both can't coexist.
 */
function derive(
  family: PanelFamily,
  mode: LayoutMode,
  persisted: PersistedState,
  lastExpanded: PanelSide | null,
): FamilyState {
  let { left, right } = persisted[family]

  // docked-tight: only one panel may be "open" at a time (the other rails).
  if (mode === "docked-tight" && left === "open" && right === "open") {
    if (lastExpanded === "right") left = "rail"
    else right = "rail"
  }

  // overlay/sheet: only one drawer may be open at a time (the other closes).
  if (isOverlayMode(mode) && left === "open" && right === "open") {
    if (lastExpanded === "right") left = "closed"
    else right = "closed"
  }

  return { left, right }
}

export function usePanelStates(mode: LayoutMode) {
  const [persisted, setPersisted] = useState<PersistedState>(loadState)
  const [lastExpanded, setLastExpanded] = useState<PanelSide | null>(null)

  useEffect(() => {
    saveState(persisted)
  }, [persisted])

  const family = familyForMode(mode)
  const derived = derive(family, mode, persisted, lastExpanded)

  const setPanelState = useCallback(
    (side: PanelSide, state: PanelState) => {
      if (state === "open") setLastExpanded(side)
      setPersisted((p) => {
        const f = familyForMode(mode)
        const other: PanelSide = side === "left" ? "right" : "left"
        const next = { ...p[f], [side]: state }
        // In overlay modes, opening one drawer auto-closes the other so the
        // persisted state stays consistent across reloads.
        if (state === "open" && isOverlayMode(mode) && next[other] === "open") {
          next[other] = "closed"
        }
        return { ...p, [f]: next }
      })
    },
    [mode],
  )

  const togglePanel = useCallback(
    (side: PanelSide) => {
      const current = side === "left" ? derived.left : derived.right
      if (isOverlayMode(mode)) {
        setPanelState(side, current === "open" ? "closed" : "open")
      } else {
        setPanelState(side, current === "open" ? "rail" : "open")
      }
    },
    [derived.left, derived.right, mode, setPanelState],
  )

  return {
    leftState: derived.left,
    rightState: derived.right,
    setPanelState,
    togglePanel,
  }
}
