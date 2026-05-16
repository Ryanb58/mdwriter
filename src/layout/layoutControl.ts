import type { PanelSide, PanelState } from "./constants"

/**
 * Imperative bridge for code that sits outside the LayoutShell tree (e.g.
 * the command palette) to open / close panels. The shell registers itself
 * via `setLayoutController` on mount; callers use `openPanel` to ensure a
 * panel is visible before performing an action like sending an AI prompt.
 */

type Controller = {
  setPanelState: (side: PanelSide, state: PanelState) => void
}

let controller: Controller | null = null

export function setLayoutController(c: Controller | null) {
  controller = c
}

export function setPanelStateGlobally(side: PanelSide, state: PanelState) {
  controller?.setPanelState(side, state)
}

export function openPanel(side: PanelSide) {
  controller?.setPanelState(side, "open")
}
