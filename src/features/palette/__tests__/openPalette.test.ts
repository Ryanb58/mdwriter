import { describe, it, expect, vi, afterEach } from "vitest"
import { openPalette, onOpenPalette } from "../openPalette"

describe("openPalette", () => {
  const listeners: Array<() => void> = []

  afterEach(() => {
    while (listeners.length) listeners.pop()!()
  })

  it("invokes a registered handler with the requested mode", () => {
    const handler = vi.fn()
    listeners.push(onOpenPalette(handler))
    openPalette("search")
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith("search")
  })

  it("unsubscribe stops further deliveries", () => {
    const handler = vi.fn()
    const off = onOpenPalette(handler)
    openPalette("file")
    off()
    openPalette("ask")
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith("file")
  })
})
