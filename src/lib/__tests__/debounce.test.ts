import { describe, it, expect, vi } from "vitest"
import { debounce } from "../debounce"

describe("debounce", () => {
  it("calls fn after wait elapses", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d.call(1); d.call(2); d.call(3)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3)
    vi.useRealTimers()
  })

  it("flush calls immediately with pending args", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d.call("x")
    d.flush()
    expect(fn).toHaveBeenCalledWith("x")
    vi.useRealTimers()
  })

  it("cancel drops pending call", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d.call("x")
    d.cancel()
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
