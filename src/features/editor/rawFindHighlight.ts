import { StateEffect, StateField } from "@codemirror/state"
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view"

export type RawFindRange = { from: number; to: number }

/** A null payload clears the active in-note Find decoration. */
export const setRawFindHighlight = StateEffect.define<RawFindRange | null>()

export const rawFindHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(highlights, transaction) {
    let next = highlights.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setRawFindHighlight)) continue
      const range = effect.value
      next = isValidRange(range, transaction.newDoc.length)
        ? Decoration.set([
            Decoration.mark({ class: "cm-find-match-exact" }).range(range.from, range.to),
          ])
        : Decoration.none
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

export const rawFindHighlightTheme = EditorView.baseTheme({
  ".cm-find-match-exact": {
    backgroundColor: "var(--color-accent-soft)",
    boxShadow: "inset 0 -2px 0 var(--color-accent)",
    borderRadius: "2px",
  },
})

/**
 * Apply one exact source range without touching CodeMirror's selection or
 * focus. The browser scroll effect is part of the same transaction.
 */
export function applyRawFindHighlight(
  view: EditorView,
  range: RawFindRange | null,
): void {
  const valid = isValidRange(range, view.state.doc.length) ? range : null
  if (!valid) {
    view.dispatch({ effects: setRawFindHighlight.of(null) })
    return
  }
  view.dispatch({
    effects: [
      setRawFindHighlight.of(valid),
      EditorView.scrollIntoView(valid.from, { y: "center" }),
    ],
  })
}

function isValidRange(
  range: RawFindRange | null,
  documentLength: number,
): range is RawFindRange {
  return Boolean(
    range &&
    Number.isInteger(range.from) &&
    Number.isInteger(range.to) &&
    range.from >= 0 &&
    range.to > range.from &&
    range.to <= documentLength,
  )
}
