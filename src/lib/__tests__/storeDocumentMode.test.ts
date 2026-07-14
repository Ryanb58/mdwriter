import { beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../store"

function resetStore() {
  useStore.setState({
    rootPath: "/vault",
    openDoc: null,
    editorMode: "block",
    preferredEditorMode: "block",
    loadError: null,
    blockModeOverrides: {},
    editorSelection: null,
  })
}

describe("document analysis store transitions", () => {
  beforeEach(resetStore)

  it("opens a safe document in the preferred editor mode", () => {
    useStore.setState({ preferredEditorMode: "raw", editorMode: "block" })

    useStore.getState().openAnalyzedDocument("/vault/safe.md", "# Safe", "disk")

    expect(useStore.getState().editorMode).toBe("raw")
    expect(useStore.getState().openDoc?.markdownRisks).toEqual([])
  })

  it("advances the editor revision for every loaded or externally replaced buffer", () => {
    useStore.setState({ docRev: 8 })

    useStore.getState().openAnalyzedDocument("/vault/a.md", "Same body", "disk")
    expect(useStore.getState().docRev).toBe(9)

    useStore.getState().openAnalyzedDocument("/vault/b.md", "Same body", "disk")
    expect(useStore.getState().docRev).toBe(10)

    useStore.getState().openAnalyzedDocument("/vault/b.md", "", "external")
    expect(useStore.getState().docRev).toBe(11)
  })

  it("atomically opens a risky document in raw mode", () => {
    const snapshots: Array<{ path: string | null; mode: string }> = []
    const unsubscribe = useStore.subscribe((state) => {
      snapshots.push({ path: state.openDoc?.path ?? null, mode: state.editorMode })
    })

    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A footnote[^one].",
      "disk",
    )
    unsubscribe()

    const state = useStore.getState()
    expect(state.openDoc?.markdownRisks.map((risk) => risk.code)).toEqual(["footnote"])
    expect(state.editorMode).toBe("raw")
    expect(snapshots).toHaveLength(1)
    expect(snapshots).not.toContainEqual({ path: "/vault/risky.md", mode: "block" })
  })

  it("blocks an unsafe block-mode request while remembering the preference", () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A footnote[^one].",
      "disk",
    )

    const result = useStore.getState().requestEditorMode("block")

    expect(result).toBe("blocked")
    expect(useStore.getState().preferredEditorMode).toBe("block")
    expect(useStore.getState().editorMode).toBe("raw")
  })

  it("lets an explicit override change only effective mode and scopes it to path and fingerprint", () => {
    useStore.setState({ preferredEditorMode: "raw" })
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A footnote[^one].",
      "disk",
    )
    const fingerprint = useStore.getState().openDoc!.contentFingerprint

    useStore.getState().overrideBlockModeForCurrentDoc()

    const state = useStore.getState()
    expect(state.editorMode).toBe("block")
    expect(state.preferredEditorMode).toBe("raw")
    expect(state.blockModeOverrides).toEqual({ "/vault/risky.md": fingerprint })
  })

  it("reanalyzes local edits, queues saving, clears errors, and advances an active override", () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A footnote[^one].",
      "disk",
    )
    useStore.getState().overrideBlockModeForCurrentDoc()
    useStore.getState().patchOpenDoc({ saveStatus: "error", saveError: "disk full" })
    const before = useStore.getState().openDoc!.contentFingerprint

    useStore.getState().editOpenDoc("A footnote[^one] with an edit.")

    const state = useStore.getState()
    expect(state.openDoc).toMatchObject({
      dirty: true,
      saveStatus: "queued",
      saveError: null,
    })
    expect(state.openDoc!.contentFingerprint).not.toBe(before)
    expect(state.blockModeOverrides["/vault/risky.md"]).toBe(
      state.openDoc!.contentFingerprint,
    )
    expect(state.editorMode).toBe("block")
  })

  it("does not downgrade an in-flight save when editing", () => {
    useStore.getState().openAnalyzedDocument("/vault/safe.md", "Safe", "disk")
    useStore.getState().patchOpenDoc({ saveStatus: "saving" })

    useStore.getState().editOpenDoc("Edited")

    expect(useStore.getState().openDoc?.saveStatus).toBe("saving")
  })

  it("does not switch renderers in the middle of a local edit", () => {
    useStore.getState().openAnalyzedDocument("/vault/safe.md", "Safe", "disk")
    expect(useStore.getState().editorMode).toBe("block")

    useStore.getState().editOpenDoc("Now risky[^one].")

    expect(useStore.getState().openDoc?.markdownRisks).not.toEqual([])
    expect(useStore.getState().editorMode).toBe("block")
  })

  it("invalidates an old override when external bytes replace the document", () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A footnote[^one].",
      "disk",
    )
    useStore.getState().overrideBlockModeForCurrentDoc()

    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A different footnote[^two].",
      "external",
    )

    const state = useStore.getState()
    expect(state.blockModeOverrides["/vault/risky.md"]).toBeUndefined()
    expect(state.editorMode).toBe("raw")
  })

  it("remaps an override when its document is renamed", () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/old.md",
      "A footnote[^one].",
      "disk",
    )
    useStore.getState().overrideBlockModeForCurrentDoc()
    const fingerprint = useStore.getState().openDoc!.contentFingerprint

    useStore.getState().remapBlockModeOverride("/vault/old.md", "/vault/new.md")

    expect(useStore.getState().blockModeOverrides).toEqual({
      "/vault/new.md": fingerprint,
    })
  })

  it("restores a blocked block preference on the next safe note", () => {
    useStore.setState({ preferredEditorMode: "raw" })
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A footnote[^one].",
      "disk",
    )
    expect(useStore.getState().requestEditorMode("block")).toBe("blocked")

    useStore.getState().openAnalyzedDocument("/vault/safe.md", "# Safe", "disk")

    expect(useStore.getState().editorMode).toBe("block")
  })

  it("updates the preference and effective mode for allowed requests", () => {
    useStore.getState().openAnalyzedDocument("/vault/safe.md", "# Safe", "disk")
    const result = useStore.getState().requestEditorMode("raw")

    expect(result).toBe("changed")
    expect(useStore.getState()).toMatchObject({
      preferredEditorMode: "raw",
      editorMode: "raw",
    })
  })

  it("opens each document with clean save metadata", () => {
    vi.setSystemTime(new Date("2026-07-14T12:00:00Z"))

    useStore.getState().openAnalyzedDocument("/vault/safe.md", "# Safe", "disk")

    expect(useStore.getState().openDoc).toMatchObject({
      dirty: false,
      savedAt: null,
      saveStatus: "clean",
      saveError: null,
    })
    vi.useRealTimers()
  })
})
