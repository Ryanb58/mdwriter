import { useEffect, useMemo } from "react"
import { ipc } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { debounce } from "../../lib/debounce"
import { noteSelfWrite } from "../watcher/useExternalChanges"

const SAVE_DELAY_MS = 500

// Module-level handle to the active autosave debounce. Exposed so the rename
// flow can drop a pending write before swapping the open doc's path — without
// this, the cleanup flush would re-create the old file at its prior path.
let activeSaver: { flush: () => void; cancel: () => void } | null = null

export function cancelPendingDocSave() {
  activeSaver?.cancel()
}

export function useAutoSave() {
  const doc = useStore((s) => s.openDoc)

  const saver = useMemo(() => debounce(async (path: string, frontmatter: Record<string, unknown>, body: string) => {
    try {
      noteSelfWrite(path)
      await ipc.writeFile(path, { frontmatter, body })
      const cur = useStore.getState().openDoc
      if (cur && cur.path === path) {
        useStore.getState().patchOpenDoc({ dirty: false, savedAt: Date.now() })
      }
    } catch (e) {
      console.error("save failed", e)
    }
  }, SAVE_DELAY_MS), [])

  useEffect(() => {
    activeSaver = saver
    return () => { if (activeSaver === saver) activeSaver = null }
  }, [saver])

  useEffect(() => {
    if (!doc || !doc.dirty) return
    saver.call(doc.path, doc.frontmatter, doc.rawMarkdown)
  }, [doc?.dirty, doc?.rawMarkdown, doc?.frontmatter, doc?.path, saver])

  // flush on path change / unmount
  useEffect(() => {
    return () => { saver.flush() }
  }, [doc?.path, saver])
}
