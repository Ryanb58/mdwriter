import { useStore } from "../../lib/store"
import { getBody, setBody } from "../../lib/doc"

export type ApplyOp =
  | { kind: "replace-selection"; markdown: string }
  | { kind: "append"; markdown: string }
  | { kind: "replace-all"; markdown: string }

export type ApplyResult =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Mutate the currently-open document by injecting assistant-authored
 * markdown. Operations work on the body slice of `text` — frontmatter
 * is preserved verbatim across every branch. `docRev` is bumped so the
 * active editor re-initialises from the new content; the autosave loop
 * persists the change.
 *
 * "replace-selection" uses the first textual occurrence of the user's
 * current selection (searched within the body); ambiguous cases prefer
 * the first match. Callers can fall back to the diff modal when that's
 * not good enough.
 */
export function applyToOpenDoc(op: ApplyOp): ApplyResult {
  const state = useStore.getState()
  const doc = state.openDoc
  if (!doc) return { ok: false, reason: "No document is open." }
  if (state.loadError) {
    return {
      ok: false,
      reason: "Resolve the file load error before editing this note.",
    }
  }

  const currentBody = getBody(doc.text)
  let nextBody: string | null = null

  switch (op.kind) {
    case "replace-all":
      nextBody = op.markdown
      break
    case "append": {
      const tail = currentBody.endsWith("\n") ? "" : "\n"
      nextBody = `${currentBody}${tail}\n${op.markdown}`
      break
    }
    case "replace-selection": {
      const sel = state.editorSelection
      if (!sel || !sel.text) {
        return { ok: false, reason: "No selection to replace." }
      }
      const idx = currentBody.indexOf(sel.text)
      if (idx === -1) {
        return { ok: false, reason: "Couldn't locate the selected text in the document." }
      }
      nextBody = currentBody.slice(0, idx) + op.markdown + currentBody.slice(idx + sel.text.length)
      break
    }
  }

  if (nextBody == null) return { ok: false, reason: "Unknown operation." }
  if (nextBody === currentBody) return { ok: true }

  const nextText = setBody(doc.text, nextBody)
  state.editOpenDoc(nextText)
  state.bumpDocRev()
  return { ok: true }
}

/**
 * Read-only preview of what `applyToOpenDoc` *would* produce, expressed
 * as before/after body strings (frontmatter is unchanged across every op).
 */
export function previewApply(op: ApplyOp): { before: string; after: string } | null {
  const state = useStore.getState()
  if (state.loadError) return null
  const doc = state.openDoc
  if (!doc) return null
  const before = getBody(doc.text)

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
