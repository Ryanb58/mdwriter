import { useStore } from "../../lib/store"

export type ApplyOp =
  | { kind: "replace-selection"; markdown: string }
  | { kind: "append"; markdown: string }
  | { kind: "replace-all"; markdown: string }

export type ApplyResult =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Mutate the currently-open document by injecting assistant-authored
 * markdown. Operations work on the store's raw markdown source and bump
 * `docRev` so the active editor re-initialises from the new content. The
 * autosave loop persists the change.
 *
 * "replace-selection" uses the first textual occurrence of the user's current
 * selection; ambiguous cases (the same text appears multiple times) prefer
 * the first match. Callers can fall back to the diff modal when that's not
 * good enough.
 */
export function applyToOpenDoc(op: ApplyOp): ApplyResult {
  const state = useStore.getState()
  const doc = state.openDoc
  if (!doc) return { ok: false, reason: "No document is open." }

  let next: string | null = null
  switch (op.kind) {
    case "replace-all":
      next = op.markdown
      break
    case "append": {
      const tail = doc.rawMarkdown.endsWith("\n") ? "" : "\n"
      next = `${doc.rawMarkdown}${tail}\n${op.markdown}`
      break
    }
    case "replace-selection": {
      const sel = state.editorSelection
      if (!sel || !sel.text) {
        return { ok: false, reason: "No selection to replace." }
      }
      const idx = doc.rawMarkdown.indexOf(sel.text)
      if (idx === -1) {
        return { ok: false, reason: "Couldn't locate the selected text in the document." }
      }
      next = doc.rawMarkdown.slice(0, idx) + op.markdown + doc.rawMarkdown.slice(idx + sel.text.length)
      break
    }
  }

  if (next == null) return { ok: false, reason: "Unknown operation." }
  if (next === doc.rawMarkdown) return { ok: true }

  state.patchOpenDoc({ rawMarkdown: next, dirty: true })
  state.bumpDocRev()
  return { ok: true }
}

/**
 * Read-only preview of what `applyToOpenDoc` *would* produce. Used by the
 * diff modal so the user can compare without committing.
 */
export function previewApply(op: ApplyOp): { before: string; after: string } | null {
  const state = useStore.getState()
  const doc = state.openDoc
  if (!doc) return null
  const before = doc.rawMarkdown

  switch (op.kind) {
    case "replace-all":
      return { before, after: op.markdown }
    case "append": {
      const tail = before.endsWith("\n") ? "" : "\n"
      return { before, after: `${before}${tail}\n${op.markdown}` }
    }
    case "replace-selection": {
      const sel = state.editorSelection
      if (!sel || !sel.text) return null
      const idx = before.indexOf(sel.text)
      if (idx === -1) return null
      return {
        before,
        after: before.slice(0, idx) + op.markdown + before.slice(idx + sel.text.length),
      }
    }
  }
}
