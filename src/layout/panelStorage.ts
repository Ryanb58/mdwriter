import { windowScopedKey } from "../lib/persistStorage"
import { PERSIST_WINDOW_LABEL } from "../lib/windowEvents"

/**
 * Persistence for the layout chrome that lives outside the zustand store.
 *
 * Panel collapse state and panel widths are per-*window* UI, exactly like
 * `rightPaneTab` in the store: dragging window B's sidebar must not resize
 * window A's, and it must not decide window A's width on the next launch.
 * Every mdwriter window is a webview on one origin sharing one `localStorage`,
 * so an unqualified key is a single blob on last-writer-wins — these hooks
 * re-read it only at mount, so the loser doesn't even find out. Namespacing by
 * window label is what keeps them separate; `persistStorage.ts` evicts the
 * entries of retired labels (see `extraWindowKeys`) so they can't accumulate
 * one set per window ever opened.
 */

export const LAYOUT_PANELS_KEY = "layout-panels-v1"
export const LAYOUT_WIDTHS_KEY = "layout-widths-v1"

/** Passed to the scoped persist storage so retired windows' entries get evicted. */
export const LAYOUT_WINDOW_KEYS: readonly string[] = [LAYOUT_PANELS_KEY, LAYOUT_WIDTHS_KEY]

/** Pre-scoping key shape: one entry shared by every window. */
const legacyKey = (name: string) => `mdwriter:${name}`

export function layoutStorageKey(name: string): string {
  return windowScopedKey(PERSIST_WINDOW_LABEL, name)
}

/**
 * Read this window's entry, falling back to the pre-scoping shared entry so an
 * upgrade keeps the layout the user had. The legacy entry is deliberately left
 * in place: windows that have not started yet still need to inherit from it,
 * and it is superseded the first time each window saves.
 */
export function loadLayoutEntry(name: string): unknown {
  if (typeof window === "undefined") return null
  for (const key of [layoutStorageKey(name), legacyKey(name)]) {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw)
    } catch {
      // Unreadable or malformed: fall through to the caller's defaults.
    }
  }
  return null
}

export function saveLayoutEntry(name: string, value: unknown): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(layoutStorageKey(name), JSON.stringify(value))
  } catch {
    // Quota / private mode: layout chrome is not worth surfacing an error for.
  }
}
