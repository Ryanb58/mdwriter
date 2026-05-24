import { useEffect } from "react"
import { useStore } from "../../lib/store"
import {
  scheduleOpenDocSave,
  flushPendingOpenDocSave,
  cancelPendingOpenDocSave,
} from "../../lib/writeDoc"

/**
 * Back-compat re-export so existing imports (watcher, renameOpenDoc)
 * keep working. New code should import directly from `lib/writeDoc`.
 */
export function cancelPendingDocSave() {
  cancelPendingOpenDocSave()
}

export function useAutoSave() {
  const doc = useStore((s) => s.openDoc)

  useEffect(() => {
    if (!doc || !doc.dirty) return
    scheduleOpenDocSave(doc.path, doc.text)
  }, [doc?.dirty, doc?.text, doc?.path])

  // flush on path change / unmount
  useEffect(() => {
    return () => { flushPendingOpenDocSave() }
  }, [doc?.path])
}
