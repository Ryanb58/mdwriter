import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

type CloseEvent = { preventDefault(): void }
type CloseHandler = (event: CloseEvent) => Promise<void> | void

const harness = vi.hoisted(() => ({
  schedule: vi.fn(),
  flush: vi.fn(() => Promise.resolve()),
  hide: vi.fn(() => Promise.resolve()),
  destroy: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  unlisten: vi.fn(),
  closeHandler: null as CloseHandler | null,
}))

vi.mock("../../../lib/writeDoc", () => ({
  scheduleOpenDocSave: harness.schedule,
  flushOpenDocSave: harness.flush,
  cancelQueuedOpenDocSave: vi.fn(),
}))

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: vi.fn(async (handler: CloseHandler) => {
      harness.closeHandler = handler
      return harness.unlisten
    }),
    hide: harness.hide,
    destroy: harness.destroy,
  }),
}))

import { ipc } from "../../../lib/ipc"
import { useStore } from "../../../lib/store"
import { useAutoSave } from "../useAutoSave"
import defaultCapability from "../../../../src-tauri/capabilities/default.json"

function openDirty(text = "edited") {
  useStore.getState().openAnalyzedDocument("/vault/note.md", "initial", "disk")
  useStore.getState().editOpenDoc(text)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("useAutoSave", () => {
  beforeEach(() => {
    harness.schedule.mockClear()
    harness.flush.mockReset()
    harness.flush.mockResolvedValue(undefined)
    harness.hide.mockClear()
    harness.destroy.mockClear()
    harness.closeWindow.mockClear()
    harness.closeWindow.mockResolvedValue(undefined)
    harness.unlisten.mockClear()
    harness.closeHandler = null
    vi.spyOn(ipc, "closeWindow").mockImplementation(harness.closeWindow)
    useStore.setState({ openDoc: null })
  })

  it("schedules dirty documents as snapshots through the coordinator", () => {
    openDirty("latest")

    renderHook(() => useAutoSave())

    expect(harness.schedule).toHaveBeenCalledWith({
      path: "/vault/note.md",
      text: "latest",
    })
  })

  it("requests an asynchronous path flush on cleanup", () => {
    openDirty()
    const { unmount } = renderHook(() => useAutoSave())

    unmount()

    expect(harness.flush).toHaveBeenCalledWith("/vault/note.md")
  })

  it("prevents close, awaits the flush, then hands the close to the backend", async () => {
    // The window must not decide its own fate here. Hiding it from the webview
    // (which is what this did on macOS) means Tauri never destroys it, so
    // `WindowEvent::Destroyed` never fires and nothing ever releases this
    // window's watcher, autosave loop or vault claim. `close_window` is the
    // only path that can pick correctly, because only Rust can count the
    // windows still open.
    const flush = deferred<void>()
    harness.flush.mockReturnValue(flush.promise)
    openDirty("close safely")
    renderHook(() => useAutoSave())
    await waitFor(() => expect(harness.closeHandler).not.toBeNull())
    const event = { preventDefault: vi.fn() }

    let closing!: Promise<void>
    act(() => {
      closing = Promise.resolve(harness.closeHandler!(event))
    })

    // The close is deferred until the pending write lands...
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(harness.flush).toHaveBeenCalledWith()
    expect(harness.closeWindow).not.toHaveBeenCalled()

    flush.resolve()
    await closing
    // ...and then completed by the backend, never by the webview itself.
    expect(harness.closeWindow).toHaveBeenCalledTimes(1)
    expect(harness.hide).not.toHaveBeenCalled()
    expect(harness.destroy).not.toHaveBeenCalled()
  })

  it("covers runtime window labels in the capability that allows the close listener", () => {
    // Capabilities are label-scoped. Without a pattern for the generated
    // `w-<uuid>` labels, a second window cannot register the close-requested
    // listener above at all, and this whole flush-then-close path is dead code
    // in every window except the first.
    expect(defaultCapability.windows).toContain("main")
    expect(defaultCapability.windows).toContain("w-*")
  })

  it("keeps the window open when the close flush fails", async () => {
    harness.flush.mockRejectedValue(new Error("disk unavailable"))
    openDirty()
    renderHook(() => useAutoSave())
    await waitFor(() => expect(harness.closeHandler).not.toBeNull())
    const event = { preventDefault: vi.fn() }

    await act(async () => {
      await harness.closeHandler!(event)
    })

    // A failed flush must not close the window: the unsaved buffer is still the
    // only copy of the user's edit (S3.3).
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(harness.closeWindow).not.toHaveBeenCalled()
    expect(harness.hide).not.toHaveBeenCalled()
    expect(harness.destroy).not.toHaveBeenCalled()
    expect(useStore.getState().openDoc?.dirty).toBe(true)
  })
})
