import { create } from "zustand"

type Source = { kind: "internal"; paths: string[] } | { kind: "external" }

type DndState = {
  active: boolean
  source: Source | null
  // Absolute folder path of the current drop target. The vault root uses
  // its full rootPath here, not "" — anywhere this is read should treat
  // it as a normal absolute path.
  dropTarget: string | null

  beginInternalDrag(paths: string[]): void
  beginExternalDrag(): void
  setDropTarget(path: string | null): void
  end(): void
}

/**
 * Tree drag-and-drop coordination. Kept in its own tiny store so it
 * doesn't bloat the main app store with frequently-updated transient
 * state. The dndStore is reset on every dragend / drop.
 */
export const useDndStore = create<DndState>((set) => ({
  active: false,
  source: null,
  dropTarget: null,

  beginInternalDrag: (paths) =>
    set({ active: true, source: { kind: "internal", paths }, dropTarget: null }),
  beginExternalDrag: () =>
    set({ active: true, source: { kind: "external" }, dropTarget: null }),
  setDropTarget: (path) => set({ dropTarget: path }),
  end: () => set({ active: false, source: null, dropTarget: null }),
}))

/**
 * Internal mdwriter drag MIME. The body is a JSON array of paths.
 * We use a custom MIME so external file drops (which only set "Files")
 * are distinguishable from a Finder drop.
 */
export const INTERNAL_DRAG_MIME = "application/x-mdwriter-tree"
