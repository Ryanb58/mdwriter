import { useEffect } from "react"
import { listenForThisWindow } from "../../lib/windowEvents"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { cancelQueuedOpenDocSave } from "../../lib/writeDoc"
import { runVaultListingExclusive } from "../../lib/vaultTransactions"
import { parent } from "../../lib/paths"
import { refreshDirectories } from "../tree/treeLoader"

type VaultEvent = { paths: string[] }

const RECENT_WRITE_WINDOW_MS = 1000
const recentSelfWrites = new Map<string, number>()

export function noteSelfWrite(path: string) {
  recentSelfWrites.set(path, Date.now())
}

/**
 * Handle a debounced batch of vault changes from the Rust watcher. Exported
 * for tests; the production listener forwards `e.payload.paths` directly.
 *
 * Two independent decisions are made here:
 *
 * - Tree refresh: skipped when every path in the batch is within our
 *   self-write window, since `recentSelfWrites` is populated immediately
 *   before each frontend-initiated write. This is purely an optimisation.
 *
 * - Open-doc reload: deliberately NOT gated by the self-write window.
 *   The window can false-positive when an external write lands within a
 *   second of an autosave — dropping the event then meant the editor would
 *   keep its stale buffer and the next autosave would clobber the external
 *   change on disk. Instead, we always re-read the file when the open path
 *   is in the batch and only bail when the bytes match what's already in
 *   the buffer (true echo or no-op write).
 *
 * Known semantic edge: if the user typed in the last ~500ms before an
 * external write lands AND the doc was clean at the moment the watcher
 * event arrived (i.e. the autosave already flushed those bytes), the
 * external write wins. The user's typed bytes are flushed first (Phase 8
 * autosave debounce), then the external reload replaces them. Dirty-in-
 * memory edits are preserved (see the `doc.dirty` guard below); only the
 * narrow already-saved-then-superseded race loses bytes, and the same
 * race existed pre-refactor.
 */
export async function handleVaultChange(paths: string[]): Promise<void> {
  await runVaultListingExclusive(async () => {
    const root = useStore.getState().rootPath
    if (!root) return

    const nonSelfPaths = paths.filter((p) => {
      const at = recentSelfWrites.get(p)
      return !at || (Date.now() - at) > RECENT_WRITE_WINDOW_MS
    })

    if (nonSelfPaths.length > 0) {
      try {
        await refreshDirectories(nonSelfPaths.map(parent))
        if (useStore.getState().rootPath !== root) return
      } catch (_err) { /* root went away */ }
    }

    const doc = useStore.getState().openDoc
    if (!doc || !paths.includes(doc.path)) return

    if (doc.dirty) {
      console.warn(`External change to dirty file ${doc.path} — keeping local edits`)
      return
    }

    try {
      const snapshot = await ipc.readFile(doc.path)
      // The read crosses an async boundary. The user may have typed, switched
      // files, or otherwise replaced the buffer while Rust was reading. Only
      // apply the result to the same unchanged, still-clean document snapshot.
      const current = useStore.getState().openDoc
      if (
        !current ||
        current.path !== doc.path ||
        current.dirty ||
        current.contentFingerprint !== doc.contentFingerprint
      ) {
        return
      }
      // Short-circuit on byte-identical content. This is what makes it safe
      // to bypass the self-write filter above: an autosave echo reads back as
      // bytes-equal to the buffer, while a real external edit doesn't. The
      // digest is a pure function of those bytes, so it already matches too.
      if (snapshot.text === current.text) return

      // Drop only queued-not-started work for this path. An active IPC write is
      // never cancelled (and cannot reach this branch because it keeps the
      // document dirty until it settles).
      cancelQueuedOpenDocSave(current.path)

      // S2.1: a clean receiver just reloads. Taking the new digest with the
      // text is what keeps this window's next save in-precondition instead of
      // conflicting against the write it just absorbed.
      const { openAnalyzedDocument } = useStore.getState()
      openAnalyzedDocument(current.path, snapshot.text, "external", snapshot.digest)
    } catch (_e) { /* file gone */ }
  })
}

export function useExternalChanges() {
  useEffect(() => {
    // Labelled subscription: this window only hears about changes under the
    // vault *it* asked the Rust watcher to watch (reference behavior S1.3).
    const unlistenP = listenForThisWindow<VaultEvent>("vault-changed", (e) => {
      void handleVaultChange(e.payload.paths)
    })
    return () => { unlistenP.then((u) => u()) }
  }, [])
}
