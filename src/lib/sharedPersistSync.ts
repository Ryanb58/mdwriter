import { useEffect } from "react"
import type { UnlistenFn } from "@tauri-apps/api/event"
import {
  PERSIST_WINDOW_LABEL,
  SHARED_PERSIST_EVENT,
  syncSharedPersistedState,
  type SharedPersistPayload,
} from "./store"
import { listenToAllWindows } from "./windowEvents"
import { SHARED_PREFIX } from "./persistStorage"

/**
 * Keep app-global preferences in step across windows.
 *
 * Splitting persistence by scope (see `persistStorage.ts`) stops one window's
 * writes from discarding another's, but on its own it leaves each window
 * showing its own stale copy until relaunch. This hook closes that gap: when
 * any window writes a shared entry, every other window re-reads the entries and
 * adopts them.
 *
 * Two notification channels, because neither is sufficient alone:
 *
 * - The DOM `storage` event. Free and instant *between browser tabs*, but the
 *   windows here are separate WKWebViews, and cross-webview delivery of storage
 *   events is not something to bet the correctness of the app on.
 * - A Tauri broadcast. Goes through the Rust event bus, so it reaches every
 *   webview regardless. `emit` has no "everyone but me" target, hence the
 *   `origin` check — re-reading our own write would be harmless but pointless.
 *
 * Whichever arrives first wins; the second is a no-op because the state already
 * matches disk. Per-window entries (`rightPaneTab`) are deliberately untouched.
 *
 * The broadcast carries only its origin, so a notification that arrives *before*
 * the value it announces would otherwise be consumed for nothing — the two
 * travel different transports (the Rust event bus vs. WebKit's own storage IPC
 * between webview processes), and nothing in the payload lets a receiver notice
 * it read too early. Two cheap retries cover that: a deferred second read, and a
 * read whenever the window is focused or revealed, so a window can never sit on
 * a stale preference while the user is looking at it.
 */

/**
 * How long to wait before the confirming re-read. Long enough to be on the far
 * side of a same-instant cross-process storage write, short enough that a user
 * switching windows sees the change already applied.
 */
const RESYNC_DELAY_MS = 250

export function useSharedPersistSync(): void {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      // `key === null` is a whole-storage clear.
      if (event.key !== null && !event.key.startsWith(SHARED_PREFIX)) return
      syncSharedPersistedState()
    }
    window.addEventListener("storage", onStorage)

    // Re-reading is idempotent and writes nothing when the state already
    // matches, so a resync on focus/reveal costs nothing and bounds how long a
    // window can show a stale preference to whatever missed a notification.
    const resync = () => syncSharedPersistedState()
    const onVisibility = () => {
      if (document.visibilityState === "visible") resync()
    }
    window.addEventListener("focus", resync)
    document.addEventListener("visibilitychange", onVisibility)

    let pending: ReturnType<typeof setTimeout> | null = null
    let unlisten: UnlistenFn | null = null
    let cancelled = false
    void listenToAllWindows<SharedPersistPayload>(SHARED_PERSIST_EVENT, (event) => {
      if (event.payload?.origin === PERSIST_WINDOW_LABEL) return
      syncSharedPersistedState()
      // The announced write may not be visible to this webview yet; read once
      // more rather than dropping the notification on the floor.
      if (pending !== null) clearTimeout(pending)
      pending = setTimeout(() => {
        pending = null
        syncSharedPersistedState()
      }, RESYNC_DELAY_MS)
    })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
      // No Tauri runtime (browser dev / tests) — the storage event still works.
      .catch(() => {})

    return () => {
      cancelled = true
      if (pending !== null) clearTimeout(pending)
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("focus", resync)
      document.removeEventListener("visibilitychange", onVisibility)
      unlisten?.()
    }
  }, [])
}
