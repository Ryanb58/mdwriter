import { describe, expect, it } from "vitest"
import {
  beginHydration,
  canEmitHydrationChange,
  createHydrationGate,
  finishHydration,
  isCurrentHydration,
  runWithHydrationSuppressed,
} from "../blockEditorHydration"

describe("BlockEditor hydration gate", () => {
  it("keeps a new hydration generation read-only until it finishes", () => {
    const gate = createHydrationGate()
    const generation = beginHydration(gate)

    expect(isCurrentHydration(gate, generation)).toBe(true)
    expect(canEmitHydrationChange(gate, generation)).toBe(false)

    finishHydration(gate, generation)

    expect(canEmitHydrationChange(gate, generation)).toBe(true)
  })

  it("rejects callbacks fired synchronously while blocks are replaced", () => {
    const gate = createHydrationGate()
    const generation = beginHydration(gate)
    finishHydration(gate, generation)
    const callbackResults: boolean[] = []

    runWithHydrationSuppressed(gate, generation, () => {
      callbackResults.push(canEmitHydrationChange(gate, generation))
    })

    expect(callbackResults).toEqual([false])
    expect(canEmitHydrationChange(gate, generation)).toBe(true)
  })

  it("invalidates the previous generation when a new hydration begins", () => {
    const gate = createHydrationGate()
    const first = beginHydration(gate)
    finishHydration(gate, first)
    const second = beginHydration(gate)

    expect(isCurrentHydration(gate, first)).toBe(false)
    expect(canEmitHydrationChange(gate, first)).toBe(false)
    expect(isCurrentHydration(gate, second)).toBe(true)
    expect(canEmitHydrationChange(gate, second)).toBe(false)
  })

  it("does not let a stale finish re-enable an older generation", () => {
    const gate = createHydrationGate()
    const first = beginHydration(gate)
    const second = beginHydration(gate)

    finishHydration(gate, first)

    expect(canEmitHydrationChange(gate, first)).toBe(false)
    expect(canEmitHydrationChange(gate, second)).toBe(false)
  })

  it("rejects an async export captured before a file switch", async () => {
    const gate = createHydrationGate()
    const first = beginHydration(gate)
    finishHydration(gate, first)
    let resolveExport!: () => void
    const exportStarted = new Promise<void>((resolve) => {
      resolveExport = resolve
    })

    const canPublish = (async () => {
      expect(canEmitHydrationChange(gate, first)).toBe(true)
      await exportStarted
      return canEmitHydrationChange(gate, first)
    })()

    beginHydration(gate)
    resolveExport()

    await expect(canPublish).resolves.toBe(false)
  })
})
