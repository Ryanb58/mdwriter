import { ipc } from "./ipc"
import { useStore } from "./store"
import { debounce } from "./debounce"
import { noteSelfWrite } from "../features/watcher/useExternalChanges"

const SAVE_DELAY_MS = 500

// Single module-scoped debounce for the open document. Every write path
// for the open doc routes through this module so the noteSelfWrite +
// cancelPendingSave + patch sequencing is owned in one place. Callers
// don't have to remember the ordering.
type SaveDebounced = {
  call: (path: string, text: string) => void
  flush: () => void
  cancel: () => void
}
let pending: SaveDebounced | null = null

function ensurePending(): SaveDebounced {
  if (pending !== null) return pending
  const created = debounce(async (path: string, text: string) => {
    try {
      noteSelfWrite(path)
      await ipc.writeFile(path, text)
      // Re-stamp after the bytes land: on a slow write (large doc, slow
      // disk) the watcher event fires relative to write completion, and a
      // stamp taken only at write start can age out of the echo window.
      noteSelfWrite(path)
      const cur = useStore.getState().openDoc
      if (cur && cur.path === path) {
        useStore.getState().patchOpenDoc({ dirty: false, savedAt: Date.now() })
      }
    } catch (e) {
      console.error("save failed", e)
    }
  }, SAVE_DELAY_MS)
  pending = created
  return created
}

/**
 * Schedule a debounced save of the open document. Subsequent calls
 * before the debounce fires replace the queued args; the most recent
 * (path, text) pair is the one that lands.
 */
export function scheduleOpenDocSave(path: string, text: string): void {
  ensurePending().call(path, text)
}

/**
 * Flush any queued save immediately. Used on path change / unmount so
 * the trailing edit doesn't get dropped.
 */
export function flushPendingOpenDocSave(): void {
  pending?.flush()
}

/**
 * Cancel any queued save without persisting. Used before applying an
 * external reload so the stale in-flight write can't clobber the
 * bytes we're about to read in.
 */
export function cancelPendingOpenDocSave(): void {
  pending?.cancel()
}

/**
 * Synchronous write — bypasses the debounce. Used by rename and other
 * explicit-flush points that need to know the bytes have hit disk
 * before they continue (e.g. before renaming the path out from under
 * the pending debounce closure).
 */
export async function writeOpenDocNow(path: string, text: string): Promise<void> {
  cancelPendingOpenDocSave()
  noteSelfWrite(path)
  await ipc.writeFile(path, text)
  noteSelfWrite(path)
}
