import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  showToast,
  dismissToast,
  subscribeToasts,
  clearToasts,
  errorText,
  type Toast,
} from "../toast"

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearToasts()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("notifies subscribers immediately with the current list", () => {
    const cb = vi.fn()
    const unsub = subscribeToasts(cb)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenLastCalledWith([])
    unsub()
  })

  it("show pushes a toast with kind defaulting to info", () => {
    let latest: Toast[] = []
    const unsub = subscribeToasts((t) => (latest = t))
    const id = showToast("saved")
    expect(latest).toHaveLength(1)
    expect(latest[0]).toMatchObject({ id, message: "saved", kind: "info" })
    unsub()
  })

  it("honors an explicit error kind", () => {
    let latest: Toast[] = []
    const unsub = subscribeToasts((t) => (latest = t))
    showToast("boom", { kind: "error" })
    expect(latest[0].kind).toBe("error")
    unsub()
  })

  it("auto-dismisses after the default 4s", () => {
    let latest: Toast[] = []
    const unsub = subscribeToasts((t) => (latest = t))
    showToast("temp")
    vi.advanceTimersByTime(3999)
    expect(latest).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(latest).toHaveLength(0)
    unsub()
  })

  it("honors a custom duration", () => {
    let latest: Toast[] = []
    const unsub = subscribeToasts((t) => (latest = t))
    showToast("quick", { duration: 1000 })
    vi.advanceTimersByTime(1000)
    expect(latest).toHaveLength(0)
    unsub()
  })

  it("manual dismiss removes only the target toast; later auto-dismiss is a no-op", () => {
    let latest: Toast[] = []
    const unsub = subscribeToasts((t) => (latest = t))
    const a = showToast("a")
    showToast("b")
    const cb = vi.fn()
    const unsub2 = subscribeToasts(cb)
    const callsBefore = cb.mock.calls.length

    dismissToast(a)
    expect(latest.map((t) => t.message)).toEqual(["b"])

    // a's auto-dismiss timer fires later but a is already gone — no emit.
    dismissToast(a)
    expect(cb.mock.calls.length).toBe(callsBefore + 1)
    unsub()
    unsub2()
  })

  it("stops notifying after unsubscribe", () => {
    const cb = vi.fn()
    const unsub = subscribeToasts(cb)
    unsub()
    showToast("after")
    expect(cb).toHaveBeenCalledTimes(1) // only the initial emit
  })
})

describe("errorText", () => {
  it("uses Error.message", () => {
    expect(errorText(new Error("nope"))).toBe("nope")
  })

  it("stringifies non-Error values", () => {
    expect(errorText("plain failure")).toBe("plain failure")
  })

  it("truncates long messages", () => {
    const long = "x".repeat(300)
    const out = errorText(long)
    expect(out.length).toBe(140)
    expect(out.endsWith("…")).toBe(true)
  })
})
