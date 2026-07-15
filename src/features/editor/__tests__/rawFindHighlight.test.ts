import { EditorState } from "@codemirror/state"
import { describe, expect, it, vi } from "vitest"
import {
  applyRawFindHighlight,
  rawFindHighlightField,
  rawFindHighlightTheme,
  setRawFindHighlight,
} from "../rawFindHighlight"

function decorationRanges(state: EditorState) {
  const ranges: Array<{ from: number; to: number; className: string | undefined }> = []
  state.field(rawFindHighlightField).between(0, state.doc.length, (from, to, value) => {
    ranges.push({ from, to, className: value.spec.class })
  })
  return ranges
}

describe("raw find highlight state", () => {
  it("adds, maps, replaces, and clears one exact decoration", () => {
    let state = EditorState.create({
      doc: "zero alpha beta",
      extensions: [rawFindHighlightField, rawFindHighlightTheme],
    })

    state = state.update({ effects: setRawFindHighlight.of({ from: 5, to: 10 }) }).state
    expect(decorationRanges(state)).toEqual([
      { from: 5, to: 10, className: "cm-find-match-exact" },
    ])

    state = state.update({ changes: { from: 0, insert: "!" } }).state
    expect(decorationRanges(state)).toEqual([
      { from: 6, to: 11, className: "cm-find-match-exact" },
    ])

    state = state.update({ effects: setRawFindHighlight.of({ from: 12, to: 16 }) }).state
    expect(decorationRanges(state)).toEqual([
      { from: 12, to: 16, className: "cm-find-match-exact" },
    ])

    state = state.update({ effects: setRawFindHighlight.of(null) }).state
    expect(decorationRanges(state)).toEqual([])
  })

  it("ignores empty and out-of-document ranges", () => {
    let state = EditorState.create({
      doc: "short",
      extensions: [rawFindHighlightField],
    })
    state = state.update({ effects: setRawFindHighlight.of({ from: 2, to: 2 }) }).state
    expect(decorationRanges(state)).toEqual([])
    state = state.update({ effects: setRawFindHighlight.of({ from: 2, to: 99 }) }).state
    expect(decorationRanges(state)).toEqual([])
  })
})

describe("applyRawFindHighlight", () => {
  it("scrolls and decorates without moving selection or focusing the editor", () => {
    const dispatch = vi.fn()
    const focus = vi.fn()
    const view = {
      state: {
        doc: { length: 20 },
        selection: { main: { from: 3, to: 7 } },
      },
      dispatch,
      focus,
    }

    applyRawFindHighlight(view as never, { from: 10, to: 14 })

    expect(dispatch).toHaveBeenCalledTimes(1)
    const transaction = dispatch.mock.calls[0][0]
    expect(transaction).not.toHaveProperty("selection")
    expect(transaction.effects).toHaveLength(2)
    expect(focus).not.toHaveBeenCalled()
    expect(view.state.selection.main).toEqual({ from: 3, to: 7 })
  })

  it("clears without scrolling", () => {
    const dispatch = vi.fn()
    applyRawFindHighlight({
      state: { doc: { length: 20 } },
      dispatch,
    } as never, null)

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0][0].effects).not.toBeInstanceOf(Array)
  })
})
