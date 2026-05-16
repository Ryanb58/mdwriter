import { createContext, useContext, type ReactNode } from "react"
import type { LayoutMode, PanelSide, PanelState } from "./constants"

export type LayoutContextValue = {
  mode: LayoutMode
  leftState: PanelState
  rightState: PanelState
  setPanelState: (side: PanelSide, state: PanelState) => void
  togglePanel: (side: PanelSide) => void
  reducedMotion: boolean
}

const LayoutContext = createContext<LayoutContextValue | null>(null)

export function LayoutProvider({
  value,
  children,
}: {
  value: LayoutContextValue
  children: ReactNode
}) {
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}

export function useLayout(): LayoutContextValue {
  const ctx = useContext(LayoutContext)
  if (!ctx) throw new Error("useLayout must be used inside <LayoutShell>")
  return ctx
}
