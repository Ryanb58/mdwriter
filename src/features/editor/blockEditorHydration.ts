export type HydrationGate = {
  generation: number
  readyGeneration: number | null
  suppressedGeneration: number | null
}

export function createHydrationGate(): HydrationGate {
  return {
    generation: 0,
    readyGeneration: null,
    suppressedGeneration: null,
  }
}

export function beginHydration(gate: HydrationGate): number {
  gate.generation += 1
  gate.readyGeneration = null
  gate.suppressedGeneration = null
  return gate.generation
}

export function isCurrentHydration(
  gate: HydrationGate,
  generation: number,
): boolean {
  return gate.generation === generation
}

export function runWithHydrationSuppressed(
  gate: HydrationGate,
  generation: number,
  fn: () => void,
): void {
  if (!isCurrentHydration(gate, generation)) return

  gate.suppressedGeneration = generation
  try {
    fn()
  } finally {
    if (gate.suppressedGeneration === generation) {
      gate.suppressedGeneration = null
    }
  }
}

export function finishHydration(
  gate: HydrationGate,
  generation: number,
): void {
  if (!isCurrentHydration(gate, generation)) return
  gate.readyGeneration = generation
}

export function canEmitHydrationChange(
  gate: HydrationGate,
  generation: number,
): boolean {
  return (
    isCurrentHydration(gate, generation) &&
    gate.readyGeneration === generation &&
    gate.suppressedGeneration !== generation
  )
}
