import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

type CloseEvent = { preventDefault(): void }
type CloseHandler = (event: CloseEvent) => Promise<void> | void

const harness = vi.hoisted(() => ({
  schedule: vi.fn(),
  flush: vi.fn(() => Promise.resolve()),
  hide: vi.fn(() => Promise.resolve()),
  destroy: vi.fn(() => Promise.resolve()),
  unlisten: vi.fn(),
  closeHandler: null as CloseHandler | null,
  isMac: false,
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

vi.mock("../../../layout/useIsMacTauri", () => ({
  isMacTauri: () => harness.isMac,
}))

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
    harness.unlisten.mockClear()
    harness.closeHandler = null
    harness.isMac = false
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

  it("prevents close, awaits the flush, then destroys the window off macOS", async () => {
    expect(defaultCapability.permissions).toContain("core:window:allow-destroy")

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

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(harness.flush).toHaveBeenCalledWith()
    expect(harness.destroy).not.toHaveBeenCalled()

    flush.resolve()
    await closing
    expect(harness.hide).not.toHaveBeenCalled()
    expect(harness.destroy).toHaveBeenCalledTimes(1)
  })

  it("prevents close, awaits the flush, then hides the window on macOS", async () => {
    expect(defaultCapability.permissions).toContain("core:window:allow-hide")

    harness.isMac = true
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

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(harness.flush).toHaveBeenCalledWith()
    expect(harness.hide).not.toHaveBeenCalled()
    expect(harness.destroy).not.toHaveBeenCalled()

    flush.resolve()
    await closing
    expect(harness.hide).toHaveBeenCalledTimes(1)
    expect(harness.destroy).not.toHaveBeenCalled()
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

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(harness.hide).not.toHaveBeenCalled()
    expect(harness.destroy).not.toHaveBeenCalled()
    expect(useStore.getState().openDoc?.dirty).toBe(true)
  })
})
