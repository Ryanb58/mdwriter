export type PaletteMode = "file" | "ask" | "search" | "recent"

const EVENT_NAME = "mdwriter:open-palette"

export function openPalette(mode: PaletteMode) {
  document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { mode } }))
}

export function onOpenPalette(handler: (mode: PaletteMode) => void): () => void {
  function listener(e: Event) {
    const detail = (e as CustomEvent<{ mode: PaletteMode }>).detail
    if (detail?.mode) handler(detail.mode)
  }
  document.addEventListener(EVENT_NAME, listener)
  return () => document.removeEventListener(EVENT_NAME, listener)
}
