export const BREAKPOINTS = {
  WIDE: 1240,
  TIGHT: 960,
  OVERLAY: 640,
} as const

export const PANEL_DIMS = {
  LEFT_DEFAULT: 280,
  LEFT_MIN: 240,
  /**
   * Absolute ceiling for the left panel's stored width. The effective max at
   * runtime is computed in LayoutShell — at minimum half the viewport in
   * docked mode, capped here so a stored width never grows unboundedly.
   */
  LEFT_MAX: 1600,
  RIGHT_DEFAULT: 320,
  RIGHT_MIN: 280,
  /**
   * Absolute ceiling for the right panel's stored width — see LEFT_MAX. The
   * runtime cap is computed dynamically in LayoutShell so the panel can take
   * half the viewport on wide screens.
   */
  RIGHT_MAX: 1600,
  RAIL: 48,
  MAIN_MIN: 640,
  TOOLBAR: 40,
} as const

export type LayoutMode = "docked-wide" | "docked-tight" | "overlay" | "mobile-sheet"
export type PanelState = "open" | "rail" | "closed"
export type PanelFamily = "docked" | "overlay"
export type PanelSide = "left" | "right"

export function modeFromWidth(w: number): LayoutMode {
  if (w >= BREAKPOINTS.WIDE) return "docked-wide"
  if (w >= BREAKPOINTS.TIGHT) return "docked-tight"
  if (w >= BREAKPOINTS.OVERLAY) return "overlay"
  return "mobile-sheet"
}

export function familyForMode(m: LayoutMode): PanelFamily {
  return m === "docked-wide" || m === "docked-tight" ? "docked" : "overlay"
}

export function isOverlayMode(m: LayoutMode): boolean {
  return m === "overlay" || m === "mobile-sheet"
}

export function isDockedMode(m: LayoutMode): boolean {
  return m === "docked-wide" || m === "docked-tight"
}
