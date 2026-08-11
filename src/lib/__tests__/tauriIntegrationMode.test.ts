import { describe, expect, it, vi } from "vitest"
import {
  loadTauriIntegrationGuest,
  shouldScheduleSilentUpdateCheck,
} from "../tauriIntegrationMode"

describe("loadTauriIntegrationGuest", () => {
  it("loads the guest only for an integration build", async () => {
    const loader = vi.fn(async () => ({}))
    await loadTauriIntegrationGuest(true, loader)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it("leaves normal builds untouched", async () => {
    const loader = vi.fn(async () => ({}))
    await loadTauriIntegrationGuest(false, loader)
    expect(loader).not.toHaveBeenCalled()
  })

  it("disables only the automatic update check in integration builds", () => {
    expect(shouldScheduleSilentUpdateCheck(true)).toBe(false)
    expect(shouldScheduleSilentUpdateCheck(false)).toBe(true)
  })
})
