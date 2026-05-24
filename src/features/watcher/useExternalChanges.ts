import { useEffect } from "react"
import { listen } from "@tauri-apps/api/event"
import { ipc } from "../../lib/ipc"
import { useStore, treeOptionsFromSettings } from "../../lib/store"
import { cancelPendingOpenDocSave } from "../../lib/writeDoc"
import { parseDoc } from "../../lib/doc"

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
  const root = useStore.getState().rootPath
  if (!root) return

  const nonSelfPaths = paths.filter((p) => {
    const at = recentSelfWrites.get(p)
    return !at || (Date.now() - at) > RECENT_WRITE_WINDOW_MS
  })

  if (nonSelfPaths.length > 0) {
    try {
      const opts = treeOptionsFromSettings(useStore.getState().settings)
      const tree = await ipc.listTree(root, opts)
      useStore.setState({ tree })
    } catch (_err) { /* root went away */ }
  }

  const doc = useStore.getState().openDoc
  if (!doc || !paths.includes(doc.path)) return

  if (doc.dirty) {
    console.warn(`External change to dirty file ${doc.path} — keeping local edits`)
    return
  }

  try {
    const text = await ipc.readFile(doc.path)
    // Short-circuit on byte-identical content. This is what makes it safe
    // to bypass the self-write filter above: an autosave echo reads back as
    // bytes-equal to the buffer, while a real external edit doesn't.
    if (text === doc.text) return

    // A debounced autosave queued *before* the external write would fire
    // ~500ms after this point with the old buffer in closure, overwriting
    // the bytes we're about to load. Cancel it.
    cancelPendingOpenDocSave()

    const parsed = parseDoc(text)
    const { setOpenDoc, bumpDocRev } = useStore.getState()
    setOpenDoc({
      path: doc.path,
      text,
      dirty: false,
      savedAt: null,
      parseError: parsed.parseError,
    })
    // Force the active editor to re-initialise from the new content. The
    // BlockEditor's init effect keys off `${path}#${docRev}`; without a
    // bump it would skip the re-init and keep displaying the old blocks.
    bumpDocRev()
  } catch (_e) { /* file gone */ }
}

export function useExternalChanges() {
  useEffect(() => {
    const unlistenP = listen<VaultEvent>("vault-changed", (e) => {
      void handleVaultChange(e.payload.paths)
    })
    return () => { unlistenP.then((u) => u()) }
  }, [])
}
