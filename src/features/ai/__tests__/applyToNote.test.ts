import { beforeEach, describe, expect, it } from "vitest"
import { useStore } from "../../../lib/store"
import { applyToOpenDoc, previewApply } from "../applyToNote"

function seedDoc(raw: string) {
  useStore.setState({
    openDoc: {
      path: "/vault/note.md",
      frontmatter: {},
      rawMarkdown: raw,
      blocks: null,
      dirty: false,
      savedAt: null,
      parseError: null,
    },
    docRev: 0,
    editorSelection: null,
  })
}

describe("applyToOpenDoc", () => {
  beforeEach(() => {
    useStore.setState({ openDoc: null, editorSelection: null, docRev: 0 })
  })

  it("replaces the whole document and bumps docRev", () => {
    seedDoc("old content")
    const result = applyToOpenDoc({ kind: "replace-all", markdown: "fresh" })
    expect(result).toEqual({ ok: true })
    expect(useStore.getState().openDoc?.rawMarkdown).toBe("fresh")
    expect(useStore.getState().openDoc?.dirty).toBe(true)
    expect(useStore.getState().docRev).toBe(1)
  })

  it("appends with separator", () => {
    seedDoc("# top\n\nbody")
    applyToOpenDoc({ kind: "append", markdown: "extra" })
    expect(useStore.getState().openDoc?.rawMarkdown).toBe("# top\n\nbody\n\nextra")
  })

  it("appends without a doubled trailing newline", () => {
    seedDoc("body\n")
    applyToOpenDoc({ kind: "append", markdown: "extra" })
    expect(useStore.getState().openDoc?.rawMarkdown).toBe("body\n\nextra")
  })

  it("refuses replace-selection without a selection", () => {
    seedDoc("hello world")
    const result = applyToOpenDoc({ kind: "replace-selection", markdown: "x" })
    expect(result).toEqual({ ok: false, reason: "No selection to replace." })
  })

  it("replaces the first occurrence of the selection text", () => {
    seedDoc("hello world. hello again.")
    useStore.setState({
      editorSelection: { text: "hello", sourcePath: "/vault/note.md", attached: true },
    })
    applyToOpenDoc({ kind: "replace-selection", markdown: "hi" })
    expect(useStore.getState().openDoc?.rawMarkdown).toBe("hi world. hello again.")
  })

  it("reports when the selection no longer matches", () => {
    seedDoc("only this")
    useStore.setState({
      editorSelection: { text: "absent", sourcePath: "/vault/note.md", attached: true },
    })
    const result = applyToOpenDoc({ kind: "replace-selection", markdown: "x" })
    expect(result.ok).toBe(false)
  })

  it("refuses when no document is open", () => {
    useStore.setState({ openDoc: null })
    const result = applyToOpenDoc({ kind: "replace-all", markdown: "x" })
    expect(result).toEqual({ ok: false, reason: "No document is open." })
  })

  it("skips docRev bump when content is unchanged", () => {
    seedDoc("same")
    const result = applyToOpenDoc({ kind: "replace-all", markdown: "same" })
    expect(result).toEqual({ ok: true })
    expect(useStore.getState().docRev).toBe(0)
  })
})

describe("previewApply", () => {
  beforeEach(() => {
    useStore.setState({ openDoc: null, editorSelection: null, docRev: 0 })
  })

  it("returns before/after without mutating the store", () => {
    seedDoc("hello world")
    const preview = previewApply({ kind: "replace-all", markdown: "new" })
    expect(preview).toEqual({ before: "hello world", after: "new" })
    expect(useStore.getState().openDoc?.rawMarkdown).toBe("hello world")
  })
})
