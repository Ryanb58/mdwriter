import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const emitToAllWindows = vi.fn(async (_event: string, _payload?: unknown) => {})
const listenToAllWindows = vi.fn(
  async (_event: string, handler: (e: { payload: unknown }) => void) => {
    broadcastHandler = handler
    return () => {
      broadcastHandler = null
    }
  },
)
let broadcastHandler: ((e: { payload: unknown }) => void) | null = null

vi.mock("../windowEvents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../windowEvents")>()),
  emitToAllWindows: (event: string, payload?: unknown) => emitToAllWindows(event, payload),
  listenToAllWindows: (event: string, handler: (e: { payload: unknown }) => void) =>
    listenToAllWindows(event, handler),
}))

import { SHARED_PREFIX } from "../persistStorage"
import { LAYOUT_WIDTHS_KEY, layoutStorageKey } from "../../layout/panelStorage"
import { useSharedPersistSync } from "../sharedPersistSync"
import {
  DEFAULT_SETTINGS,
  PERSIST_WINDOW_LABEL,
  SHARED_PERSIST_EVENT,
  persistedStorageForTests,
  useStore,
} from "../store"

/** Simulate another window having written an app-global entry. */
function otherWindowWrote(theme: "light" | "dark") {
  localStorage.setItem(
    `${SHARED_PREFIX}settings`,
    JSON.stringify({ ...DEFAULT_SETTINGS, theme }),
  )
}

describe("cross-window notification of app-global changes", () => {
  beforeEach(() => {
    listenToAllWindows.mockClear()
    broadcastHandler = null
    useStore.setState({ settings: { ...DEFAULT_SETTINGS }, rightPaneTab: "properties" })
    persistedStorageForTests.removeItem("mdwriter")
    // Re-seed the entries this window last wrote, so a test's first write is
    // compared against a baseline rather than against empty storage.
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    emitToAllWindows.mockClear()
  })

  it("broadcasts when an app-global entry changes", () => {
    useStore.getState().setSetting("hideGitignored", true)

    expect(emitToAllWindows).toHaveBeenCalledWith(SHARED_PERSIST_EVENT, {
      origin: PERSIST_WINDOW_LABEL,
    })
  })

  it("stays quiet for per-window state and for writes that change nothing", () => {
    useStore.getState().setRightPaneTab("ai")
    // The keystroke case: persist writes the whole slice on every setState.
    useStore.setState({ selectedPath: "/vault/note.md" })

    expect(emitToAllWindows).not.toHaveBeenCalled()
  })

  it("adopts the change when another window broadcasts", () => {
    const { unmount } = renderHook(() => useSharedPersistSync())
    expect(listenToAllWindows).toHaveBeenCalledWith(SHARED_PERSIST_EVENT, expect.any(Function))

    otherWindowWrote("dark")
    broadcastHandler?.({ payload: { origin: "w-other" } })

    expect(useStore.getState().settings.theme).toBe("dark")
    unmount()
  })

  it("ignores its own broadcast", () => {
    renderHook(() => useSharedPersistSync())

    // Tauri's `emit` has no "everyone but me" target, so the sender hears
    // itself; re-reading would be wasted work on every preference change.
    otherWindowWrote("dark")
    broadcastHandler?.({ payload: { origin: PERSIST_WINDOW_LABEL } })

    expect(useStore.getState().settings.theme).toBe("system")
  })

  it("also reacts to a DOM storage event for a shared key", () => {
    renderHook(() => useSharedPersistSync())

    otherWindowWrote("dark")
    window.dispatchEvent(new StorageEvent("storage", { key: `${SHARED_PREFIX}settings` }))

    expect(useStore.getState().settings.theme).toBe("dark")
  })

  it("does not re-read on an unrelated storage event", () => {
    renderHook(() => useSharedPersistSync())

    otherWindowWrote("dark")
    window.dispatchEvent(
      new StorageEvent("storage", { key: layoutStorageKey(LAYOUT_WIDTHS_KEY) }),
    )

    expect(useStore.getState().settings.theme).toBe("system")
  })

  /**
   * The broadcast says only *that* something changed, and it does not travel
   * with the value: the notification goes over the Rust event bus while the
   * write propagates between webview processes over WebKit's own storage IPC.
   * A notification that overtakes its write would otherwise be consumed for
   * nothing — the receiver has no way to tell it read too early, and nothing
   * re-reads until this window's next write.
   */
  it("re-reads after the notification in case the write was not visible yet", () => {
    vi.useFakeTimers()
    try {
      renderHook(() => useSharedPersistSync())

      // The notification arrives first; the value is not readable yet.
      broadcastHandler?.({ payload: { origin: "w-other" } })
      expect(useStore.getState().settings.theme).toBe("system")

      otherWindowWrote("dark")
      vi.advanceTimersByTime(1000)

      expect(useStore.getState().settings.theme).toBe("dark")
    } finally {
      vi.useRealTimers()
    }
  })

  it("re-reads when the window is focused", () => {
    // Last resort for a notification lost entirely: a window must never show a
    // stale preference to the user who is looking at it.
    renderHook(() => useSharedPersistSync())

    otherWindowWrote("dark")
    window.dispatchEvent(new Event("focus"))

    expect(useStore.getState().settings.theme).toBe("dark")
  })

  it("stops re-reading once the window unmounts", () => {
    vi.useFakeTimers()
    try {
      const { unmount } = renderHook(() => useSharedPersistSync())
      broadcastHandler?.({ payload: { origin: "w-other" } })
      unmount()

      otherWindowWrote("dark")
      vi.advanceTimersByTime(1000)
      window.dispatchEvent(new Event("focus"))

      expect(useStore.getState().settings.theme).toBe("system")
    } finally {
      vi.useRealTimers()
    }
  })

  it("stops listening when the window unmounts", () => {
    const { unmount } = renderHook(() => useSharedPersistSync())
    unmount()

    otherWindowWrote("dark")
    window.dispatchEvent(new StorageEvent("storage", { key: `${SHARED_PREFIX}settings` }))

    expect(useStore.getState().settings.theme).toBe("system")
  })
})
