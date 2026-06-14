import { beforeEach, describe, expect, it } from "vitest"
import { useStore } from "../store"

function reset() {
  useStore.setState({
    openDoc: null,
    editorSelection: null,
    rootPath: null,
    recentFilesByVault: {},
  })
}

function makeDoc(path: string) {
  return { path, text: "# hello\n", dirty: false, savedAt: null, parseError: null }
}

describe("editorSelection", () => {
  beforeEach(reset)

  it("setEditorSelection stores a non-empty selection as attached", () => {
    useStore.getState().setEditorSelection({ text: "some text", sourcePath: "/v/a.md" })
    expect(useStore.getState().editorSelection).toEqual({
      text: "some text",
      sourcePath: "/v/a.md",
      attached: true,
    })
  })

  it("setOpenDoc clears a stale selection when switching to another file", () => {
    useStore.getState().setOpenDoc(makeDoc("/v/a.md"))
    useStore.getState().setEditorSelection({ text: "stale", sourcePath: "/v/a.md" })
    useStore.getState().setOpenDoc(makeDoc("/v/b.md"))
    expect(useStore.getState().editorSelection).toBeNull()
  })

  it("setOpenDoc clears the selection on close (null doc) too", () => {
    useStore.getState().setOpenDoc(makeDoc("/v/a.md"))
    useStore.getState().setEditorSelection({ text: "stale", sourcePath: "/v/a.md" })
    useStore.getState().setOpenDoc(null)
    expect(useStore.getState().editorSelection).toBeNull()
  })
})
