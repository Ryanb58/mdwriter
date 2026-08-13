import { ipc, saveConflictDetail } from "./ipc"
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
/**
 * Path whose save was refused because disk moved on underneath it (S2.3).
 *
 * A conflict is not a transient failure: retrying the identical bytes against
 * the identical disk state fails identically. So unlike an ordinary failure —
 * which the next keystroke retries — this parks automatic saving for the path
 * until the user picks a resolution, and the user's buffer is left dirty and
 * intact meanwhile (S2.2/S2.5). Without the park, autosave would re-fire every
 * 500 keystroke-debounce and spin against the same wall.
 */
let conflictPath: string | null = null
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
  // A new edit retries a failure for the same document — but not a conflict,
  // which typing cannot resolve. A failure belonging to another path must not
  // disappear merely because that other document queued work while its write
  // was still active.
  if (failed?.snapshot.path === snapshot.path && conflictPath !== snapshot.path) {
    failed = null
    automaticBlocked = false
  }
  if (debounce) scheduleDebounce()
  else {
    clearDebounce()
    queuedReady = true
  }
  if (conflictPath === snapshot.path) {
    // Keep editing freely; the buffer stays dirty and the unresolved-conflict
    // status stays on screen rather than flickering back to "Unsaved".
    patchCurrentDoc(snapshot.path, { dirty: true })
  } else if (!active || active.snapshot.path !== snapshot.path) {
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
  if (active || !queued || !queuedReady) return
  if (automaticBlocked && failed?.snapshot.path === queued.path) return
  if (
    automaticBlocked &&
    failed &&
    failed.snapshot.path !== queued.path &&
    failed.snapshot.path !== conflictPath
  ) {
    // A failure for a no-longer-current path has no visible retry surface.
    // If another path is already queued (a defensive cross-navigation case),
    // let that path become authoritative instead of stranding it forever.
    // A conflict is exempt: it has its own surface and its own resolutions.
    failed = null
    automaticBlocked = false
  }
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

/**
 * The precondition to send with this write: the digest of the bytes this
 * window last saw on disk for the path.
 *
 * Read live from the store rather than captured with the snapshot, because a
 * successful save (or a watcher reload) advances it, and each write has to
 * assert against the most recent thing this window actually saw. When the
 * coordinator is finishing work for a path the store has already moved off,
 * there is nothing this window can honestly assert, so the write goes
 * unconditional — the same behavior as before preconditions existed.
 */
function preconditionFor(path: string): string | null {
  const current = useStore.getState().openDoc
  return current?.path === path ? current.diskDigest : null
}

async function performWrite(snapshot: SaveSnapshot, runGeneration: number): Promise<void> {
  let didFail = false
  let thrown: unknown = null
  let writtenDigest: string | null = null
  noteSelfWrite(snapshot.path)
  try {
    writtenDigest =
      (await ipc.writeFile(snapshot.path, snapshot.text, preconditionFor(snapshot.path))) ??
      null
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
    const conflict = saveConflictDetail(thrown)
    if (conflict) {
      // S2.3: the file changed underneath us. Park automatic saving, keep the
      // buffer exactly as the user left it, and hand the decision to them.
      conflictPath = snapshot.path
      patchCurrentDoc(snapshot.path, {
        dirty: true,
        saveStatus: "conflict",
        saveError: "This file changed on disk since you opened it.",
      })
      useStore.getState().setSaveConflict({
        path: snapshot.path,
        expectedDigest: conflict.expectedDigest,
        actualDigest: conflict.actualDigest,
        dismissed: false,
      })
      console.warn("save blocked: file changed on disk", conflict)
    } else {
      const message = displaySafeError(thrown)
      patchCurrentDoc(snapshot.path, {
        dirty: true,
        saveStatus: "error",
        saveError: message,
      })
      console.error("save failed", thrown)
      showToast(`Couldn't save ${basename(snapshot.path)}`, { kind: "error" })
    }
    notifyWaiters()
    // A later snapshot for another path must still advance. This is mainly a
    // defensive backstop: guarded navigation normally prevents two document
    // paths from entering the coordinator together.
    pump()
    return
  }

  if (failed?.snapshot.path === snapshot.path) failed = null
  automaticBlocked = Boolean(failed)
  const current = useStore.getState().openDoc
  // Carry the precondition forward from the bytes just written. Skipping this
  // would make the *next* save conflict with this window's own work.
  const digestPatch = current?.path === snapshot.path ? { diskDigest: writtenDigest } : {}
  if (
    current &&
    current.path === snapshot.path &&
    current.text === snapshot.text
  ) {
    useStore.getState().patchOpenDoc({
      ...digestPatch,
      dirty: false,
      savedAt: Date.now(),
      saveStatus: "clean",
      saveError: null,
    })
  } else if (current?.path === snapshot.path && current.dirty) {
    useStore.getState().patchOpenDoc({ ...digestPatch, saveStatus: "queued" })
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
    if (!hasWork(path)) {
      // A public flush doubles as a navigation barrier. Even a currently
      // clean document must wait for an in-flight path mutation, because the
      // user can type while that mutation's IPC call is pending.
      if (!ignorePause && pauseDepth > 0) {
        await waitForCoordinatorChange()
        if (captureCurrent) captureCurrentDirtySnapshot(path)
        continue
      }
      return
    }

    if (queued && pathMatches(queued.path, path)) queuedReady = true
    pump(ignorePause)
    await waitForCoordinatorChange()
    const settledFailure = matchingFailure(path)
    if (settledFailure) throw settledFailure.error
    if (captureCurrent) captureCurrentDirtySnapshot(path)
  }
}

/** Flush queued bytes and wait behind any open path-mutation barrier. */
export async function flushOpenDocSave(path?: string): Promise<void> {
  let currentPath = path
  while (true) {
    await flushInternal(currentPath, {
      captureCurrent: true,
      ignorePause: false,
    })
    if (currentPath === undefined) return

    // A mutation may have remapped the open document while this caller was
    // waiting. Follow its dirty bytes to the destination before navigation is
    // allowed to replace the buffer.
    const current = useStore.getState().openDoc
    if (!current?.dirty || current.path === currentPath) return
    currentPath = current.path
  }
}

/** Retry immediately with the latest in-memory snapshot. */
export async function retryOpenDocSave(): Promise<void> {
  const current = useStore.getState().openDoc
  const snapshot = current?.dirty
    ? { path: current.path, text: current.text }
    : queued ?? failed?.snapshot
  if (!snapshot) return

  queueSnapshot(snapshot, false)
  await flushOpenDocSave(snapshot.path)
}

// --- Conflict resolution (reference behavior S2.4 / S2.5) ------------------
//
// VS Code offers "Compare" and "Overwrite" on a blocked save. There is no diff
// view in mdwriter and building one is out of scope for this piece, so Compare
// is deliberately not offered. What is offered instead is both directions of
// the decision, each explicit: overwrite disk with my version, or throw my
// version away and take disk. Neither side loses data without the user
// choosing it, which is the property S2.5 actually asks for.

function clearConflict(path: string): void {
  if (conflictPath === path) conflictPath = null
  if (failed?.snapshot.path === path) {
    failed = null
    automaticBlocked = false
  }
  if (useStore.getState().saveConflict?.path === path) {
    useStore.getState().setSaveConflict(null)
  }
}

/** Bytes to write when resolving in the user's favour: the live buffer, or the
 *  refused snapshot if the buffer has somehow moved on from this path. */
function localVersionText(path: string): string | null {
  const current = useStore.getState().openDoc
  if (current?.path === path) return current.text
  if (failed?.snapshot.path === path) return failed.snapshot.text
  if (queued?.path === path) return queued.text
  return null
}

/**
 * Resolve the open conflict by keeping the user's buffer and overwriting what
 * is on disk. Drops the precondition for exactly this write — the user has
 * been shown the conflict and said "mine wins" — and the write re-establishes
 * a fresh digest for everything after it.
 */
export async function overwriteWithLocalVersion(): Promise<void> {
  const conflict = useStore.getState().saveConflict
  if (!conflict) return
  const { path } = conflict
  const text = localVersionText(path)
  clearConflict(path)
  if (text === null) return
  patchCurrentDoc(path, { diskDigest: null })
  queueSnapshot({ path, text }, false)
  await flushOpenDocSave(path)
}

/**
 * Resolve the open conflict the other way: discard the local edits and take
 * what is on disk. Only clears the conflict once the read succeeds — a failed
 * read must leave the buffer, and the block on saving it, exactly as they were.
 */
export async function reloadDiscardingLocalChanges(): Promise<void> {
  const conflict = useStore.getState().saveConflict
  if (!conflict) return
  const { path } = conflict

  const snapshot = await ipc.readFile(path)
  if (useStore.getState().saveConflict?.path !== path) return
  cancelQueuedOpenDocSave(path)
  clearConflict(path)
  if (useStore.getState().openDoc?.path !== path) return
  useStore.getState().openAnalyzedDocument(path, snapshot.text, "external", snapshot.digest)
}

/** Close the conflict dialog without deciding. The conflict stays live and
 *  automatic saving stays parked; the status bar keeps a way back in. */
export function dismissConflictDialog(): void {
  const conflict = useStore.getState().saveConflict
  if (!conflict || conflict.dismissed) return
  useStore.getState().setSaveConflict({ ...conflict, dismissed: true })
}

/** Reopen the dialog for a conflict the user set aside. */
export function reopenConflictDialog(): void {
  const conflict = useStore.getState().saveConflict
  if (!conflict || !conflict.dismissed) return
  useStore.getState().setSaveConflict({ ...conflict, dismissed: false })
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
    const prefix = fromRoot.endsWith(separator)
      ? fromRoot
      : `${fromRoot}${separator}`
    if (path.startsWith(prefix)) {
      const targetPrefix = toRoot.endsWith(separator)
        ? toRoot
        : `${toRoot}${separator}`
      return `${targetPrefix}${path.slice(prefix.length)}`
    }
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
  if (conflictPath) {
    const path = remapPath(conflictPath, from, to)
    if (path) {
      conflictPath = path
      const conflict = useStore.getState().saveConflict
      if (conflict) useStore.getState().setSaveConflict({ ...conflict, path })
    }
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
  // The file is gone (deleted/moved away), so there is nothing left to
  // reconcile against — a stale conflict prompt would only strand the user.
  if (conflictPath && underAny(conflictPath, roots)) {
    conflictPath = null
    if (useStore.getState().saveConflict) useStore.getState().setSaveConflict(null)
  }
  notifyWaiters()
}

export type OpenDocPathMutation = {
  flush(path?: string): Promise<void>
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
  // Path mutations are exclusive. A later guard must never use its privileged
  // flush to bypass an earlier guard while that operation is deciding whether
  // queued bytes should be remapped or discarded.
  while (pauseDepth > 0) await waitForCoordinatorChange()
  pauseDepth = 1

  try {
    // Work can outlive the document that originally scheduled it. Inspect the
    // coordinator as well as the current store document so an affected active
    // write always settles before the filesystem path is changed.
    while (true) {
      const current = useStore.getState().openDoc
      const affectedPath =
        (active && underAny(active.snapshot.path, affectedRoots)
          ? active.snapshot.path
          : undefined) ??
        (queued && underAny(queued.path, affectedRoots)
          ? queued.path
          : undefined) ??
        (current?.dirty && underAny(current.path, affectedRoots)
          ? current.path
          : undefined) ??
        (failed && underAny(failed.snapshot.path, affectedRoots)
          ? failed.snapshot.path
          : undefined)

      if (!affectedPath) break
      await flushInternal(affectedPath, {
        captureCurrent: current?.path === affectedPath,
        ignorePause: true,
      })
    }
  } catch (error) {
    pauseDepth = 0
    pump()
    notifyWaiters()
    throw error
  }

  let released = false
  return {
    flush: (path) => flushInternal(path, {
      captureCurrent: true,
      ignorePause: true,
    }),
    remap: remapOpenDocSavePath,
    discard: discardOpenDocSaveRoots,
    release() {
      if (released) return
      released = true
      pauseDepth = 0
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
  conflictPath = null
  pauseDepth = 0
  notifyWaiters()
}
