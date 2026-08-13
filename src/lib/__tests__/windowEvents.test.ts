import { beforeEach, describe, expect, it, vi } from "vitest"

const listen = vi.fn(async () => () => {})
const emitTo = vi.fn(async () => {})
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listen(...(args as [])),
  emitTo: (...args: unknown[]) => emitTo(...(args as [])),
}))

let label: string | null = "b"
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => {
    // Outside the desktop shell this reads an undefined global and throws,
    // which is what `label = null` stands in for.
    if (label === null) throw new TypeError("no __TAURI_INTERNALS__")
    return { label }
  },
}))

import { emitToThisWindow, listenForThisWindow } from "../windowEvents"

describe("listenForThisWindow", () => {
  beforeEach(() => {
    listen.mockClear()
    emitTo.mockClear()
    label = "b"
  })

  it("registers against this window's label so addressed emits stay addressed", async () => {
    // Rust emits with `emit_to(label, ...)`. A bare `listen()` registers
    // EventTarget::Any, which Tauri delivers to no matter the address — so the
    // labelled target is what keeps window A's watcher out of window B.
    const handler = vi.fn()
    await listenForThisWindow("vault-changed", handler)

    expect(listen).toHaveBeenCalledWith("vault-changed", handler, {
      target: { kind: "WebviewWindow", label: "b" },
    })
  })

  it("falls back to an unscoped listener outside the desktop shell", async () => {
    label = null
    const handler = vi.fn()

    await listenForThisWindow("vault-changed", handler)

    expect(listen).toHaveBeenCalledWith("vault-changed", handler)
  })
})

describe("emitToThisWindow", () => {
  beforeEach(() => {
    listen.mockClear()
    emitTo.mockClear()
    label = "b"
  })

  it("addresses only this window", async () => {
    await emitToThisWindow("menu:check-updates")

    expect(emitTo).toHaveBeenCalledWith(
      { kind: "WebviewWindow", label: "b" },
      "menu:check-updates",
      undefined,
    )
  })

  it("is a no-op outside the desktop shell", async () => {
    label = null

    await emitToThisWindow("menu:check-updates")

    expect(emitTo).not.toHaveBeenCalled()
  })
})
