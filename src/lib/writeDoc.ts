import { ipc } from "./ipc"
import { useStore } from "./store"
import { basename } from "./paths"
import { showToast } from "./toast"
import { noteSelfWrite } from "../features/watcher/useExternalChanges"

const SAVE_DELAY_MS = 500
const MAX_ERROR_LENGTH = 160

export type SaveSnapshot = { path: string; text: string }

type ActiveSave = {
  snapshot: SaveSnapshot
  promise: Promise<void>
}

type FailedSave = {
  snapshot: SaveSnapshot
  error: unknown
}

let active: ActiveSave | null = null
let queued: SaveSnapshot | null = null
let queuedReady = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let failed: FailedSave | null = null
let automaticBlocked = false
let pauseDepth = 0
let generation = 0
const waiters = new Set<() => void>()

function sameSnapshot(a: SaveSnapshot | null, b: SaveSnapshot): boolean {
  return Boolean(a && a.path === b.path && a.text === b.text)
}

function clearDebounce(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = null
}

function notifyWaiters(): void {
  const current = [...waiters]
  waiters.clear()
  for (const resolve of current) resolve()
}

function waitForCoordinatorChange(): Promise<void> {
  return new Promise((resolve) => waiters.add(resolve))
}

function patchCurrentDoc(
  path: string,
  patch: Parameters<ReturnType<typeof useStore.getState>["patchOpenDoc"]>[0],
): void {
  if (useStore.getState().openDoc?.path === path) {
    useStore.getState().patchOpenDoc(patch)
  }
}

function displaySafeError(error: unknown): string {
  let message = "Couldn't save this note."
  if (error instanceof Error && error.message.trim()) message = error.message
  else if (
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    message = (error as { message: string }).message
  }
  const singleLine = message.replace(/\s+/g, " ").trim()
  return singleLine.length > MAX_ERROR_LENGTH
    ? `${singleLine.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : singleLine
}

function scheduleDebounce(): void {
  clearDebounce()
  queuedReady = false
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    queuedReady = true
    pump()
  }, SAVE_DELAY_MS)
}

function queueSnapshot(snapshot: SaveSnapshot, debounce: boolean): void {
  queued = { ...snapshot }
  failed = null
  automaticBlocked = false
  if (debounce) scheduleDebounce()
  else {
    clearDebounce()
    queuedReady = true
  }
  if (!active || active.snapshot.path !== snapshot.path) {
    patchCurrentDoc(snapshot.path, {
      dirty: true,
      saveStatus: "queued",
      saveError: null,
    })
  } else {
    patchCurrentDoc(snapshot.path, { dirty: true, saveError: null })
  }
  notifyWaiters()
}

function pathMatches(path: string, requested?: string): boolean {
  return requested === undefined || path === requested
}

function hasWork(path?: string): boolean {
  return Boolean(
    (active && pathMatches(active.snapshot.path, path)) ||
    (queued && pathMatches(queued.path, path)),
  )
}

function matchingFailure(path?: string): FailedSave | null {
  return failed && pathMatches(failed.snapshot.path, path) ? failed : null
}

function pump(ignorePause = false): void {
  if (active || !queued || !queuedReady || automaticBlocked) return
  if (pauseDepth > 0 && !ignorePause) return

  const snapshot = queued
  queued = null
  queuedReady = false
  clearDebounce()
  patchCurrentDoc(snapshot.path, {
    dirty: true,
    saveStatus: "saving",
    saveError: null,
  })

  const runGeneration = generation
  const promise = performWrite(snapshot, runGeneration)
  active = { snapshot, promise }
  notifyWaiters()
}

async function performWrite(snapshot: SaveSnapshot, runGeneration: number): Promise<void> {
  let didFail = false
  let thrown: unknown = null
  noteSelfWrite(snapshot.path)
  try {
    await ipc.writeFile(snapshot.path, snapshot.text)
  } catch (error) {
    didFail = true
    thrown = error
  } finally {
    noteSelfWrite(snapshot.path)
  }

  if (runGeneration !== generation) return
  active = null

  if (didFail) {
    failed = { snapshot, error: thrown }
    automaticBlocked = true
    const message = displaySafeError(thrown)
    patchCurrentDoc(snapshot.path, {
      dirty: true,
      saveStatus: "error",
      saveError: message,
    })
    console.error("save failed", thrown)
    showToast(`Couldn't save ${basename(snapshot.path)}`, { kind: "error" })
    notifyWaiters()
    return
  }

  failed = null
  const current = useStore.getState().openDoc
  if (
    current &&
    current.path === snapshot.path &&
    current.text === snapshot.text
  ) {
    useStore.getState().patchOpenDoc({
      dirty: false,
      savedAt: Date.now(),
      saveStatus: "clean",
      saveError: null,
    })
  } else if (current?.path === snapshot.path && current.dirty) {
    useStore.getState().patchOpenDoc({ saveStatus: "queued" })
  }

  notifyWaiters()
  pump()
}

/** Queue the latest open-document snapshot behind a 500ms debounce. */
export function scheduleOpenDocSave(snapshot: SaveSnapshot): void {
  if (sameSnapshot(active?.snapshot ?? null, snapshot) && !queued) return
  queueSnapshot(snapshot, true)
}

function captureCurrentDirtySnapshot(path?: string): void {
  const current = useStore.getState().openDoc
  if (!current?.dirty || !pathMatches(current.path, path)) return
  const latest = { path: current.path, text: current.text }
  if (sameSnapshot(active?.snapshot ?? null, latest) || sameSnapshot(queued, latest)) return
  queueSnapshot(latest, false)
}

async function flushInternal(
  path: string | undefined,
  { captureCurrent, ignorePause }: { captureCurrent: boolean; ignorePause: boolean },
): Promise<void> {
  const existingFailure = matchingFailure(path)
  if (existingFailure) {
    const current = useStore.getState().openDoc
    const hasNewerCurrentBytes = Boolean(
      captureCurrent &&
      current?.dirty &&
      pathMatches(current.path, path) &&
      !sameSnapshot(existingFailure.snapshot, {
        path: current.path,
        text: current.text,
      }),
    )
    if (!hasNewerCurrentBytes) throw existingFailure.error
    failed = null
    automaticBlocked = false
  }
  if (captureCurrent) captureCurrentDirtySnapshot(path)
  if (queued && pathMatches(queued.path, path)) {
    clearDebounce()
    queuedReady = true
  }

  while (true) {
    const failure = matchingFailure(path)
    if (failure) throw failure.error
    if (!hasWork(path)) return

    if (queued && pathMatches(queued.path, path)) queuedReady = true
    pump(ignorePause)
    await waitForCoordinatorChange()
    const settledFailure = matchingFailure(path)
    if (settledFailure) throw settledFailure.error
    if (captureCurrent) captureCurrentDirtySnapshot(path)
  }
}

/** Flush queued bytes immediately and wait until all matching writes settle. */
export function flushOpenDocSave(path?: string): Promise<void> {
  return flushInternal(path, { captureCurrent: true, ignorePause: true })
}

/** Retry immediately with the latest in-memory snapshot. */
export async function retryOpenDocSave(): Promise<void> {
  const current = useStore.getState().openDoc
  const snapshot = current?.dirty
    ? { path: current.path, text: current.text }
    : queued ?? failed?.snapshot
  if (!snapshot) return

  queueSnapshot(snapshot, false)
  pump(true)
  await flushInternal(snapshot.path, { captureCurrent: true, ignorePause: true })
}

/** Remove work that has not started. The active IPC write is never cancelled. */
export function cancelQueuedOpenDocSave(path?: string): void {
  if (!queued || !pathMatches(queued.path, path)) return
  queued = null
  queuedReady = false
  clearDebounce()
  notifyWaiters()
}

function remapPath(path: string, fromRoot: string, toRoot: string): string | null {
  if (path === fromRoot) return toRoot
  for (const separator of ["/", "\\"]) {
    const prefix = `${fromRoot}${separator}`
    if (path.startsWith(prefix)) return `${toRoot}${separator}${path.slice(prefix.length)}`
  }
  return null
}

function underAny(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => remapPath(path, root, root) !== null)
}

/** Remap queued/failed snapshots after a successful filesystem rename. */
export function remapOpenDocSavePath(from: string, to: string): void {
  if (queued) {
    const path = remapPath(queued.path, from, to)
    if (path) queued = { ...queued, path }
  }
  if (failed) {
    const path = remapPath(failed.snapshot.path, from, to)
    if (path) failed = { ...failed, snapshot: { ...failed.snapshot, path } }
  }
  notifyWaiters()
}

function discardOpenDocSaveRoots(roots: readonly string[]): void {
  if (queued && underAny(queued.path, roots)) {
    queued = null
    queuedReady = false
    clearDebounce()
  }
  if (failed && underAny(failed.snapshot.path, roots)) {
    failed = null
    automaticBlocked = false
  }
  notifyWaiters()
}

export type OpenDocPathMutation = {
  remap(fromRoot: string, toRoot: string): void
  discard(roots: readonly string[]): void
  release(): void
}

/**
 * Pause automatic pumping while a path-changing IPC operation is in flight.
 * Existing affected bytes are flushed before the caller receives the guard;
 * edits made afterward stay queued until remap/discard + release.
 */
export async function beginOpenDocPathMutation(
  affectedRoots: readonly string[],
): Promise<OpenDocPathMutation> {
  pauseDepth += 1
  const current = useStore.getState().openDoc
  const affectedPath = current && underAny(current.path, affectedRoots)
    ? current.path
    : undefined

  try {
    if (affectedPath) {
      await flushInternal(affectedPath, { captureCurrent: true, ignorePause: true })
    }
  } catch (error) {
    pauseDepth = Math.max(0, pauseDepth - 1)
    pump()
    throw error
  }

  let released = false
  return {
    remap: remapOpenDocSavePath,
    discard: discardOpenDocSaveRoots,
    release() {
      if (released) return
      released = true
      pauseDepth = Math.max(0, pauseDepth - 1)
      pump()
      notifyWaiters()
    },
  }
}

/** Reset module state and detach pending timers/promises between unit tests. */
export function resetSaveCoordinatorForTests(): void {
  generation += 1
  clearDebounce()
  active = null
  queued = null
  queuedReady = false
  failed = null
  automaticBlocked = false
  pauseDepth = 0
  notifyWaiters()
}

// Temporary compatibility for Task 9 path-operation callers. These aliases
// preserve the old cancellation import while routing it into the coordinator.
export const cancelPendingOpenDocSave = cancelQueuedOpenDocSave
