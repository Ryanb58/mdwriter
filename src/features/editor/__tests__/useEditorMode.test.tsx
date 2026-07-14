import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { useStore } from "../../../lib/store"
import { useEditorMode } from "../useEditorMode"

describe("useEditorMode", () => {
  beforeEach(() => {
    useStore.setState({
      openDoc: null,
      editorMode: "block",
      preferredEditorMode: "block",
      blockModeOverrides: {},
    })
  })

  it("routes direct mode requests through the compatibility guard", () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A footnote[^one].",
      "disk",
    )
    const { result } = renderHook(() => useEditorMode())

    let outcome: "changed" | "blocked" | undefined
    act(() => {
      outcome = result.current.requestMode("block")
    })

    expect(outcome).toBe("blocked")
    expect(useStore.getState().editorMode).toBe("raw")
    expect(useStore.getState().preferredEditorMode).toBe("block")
  })

  it("lets an allowed direct request update the mode", () => {
    useStore.getState().openAnalyzedDocument("/vault/safe.md", "# Safe", "disk")
    const { result } = renderHook(() => useEditorMode())

    act(() => {
      result.current.requestMode("raw")
    })

    expect(useStore.getState().editorMode).toBe("raw")
  })

  it("guards the Cmd/Ctrl+E shortcut instead of bypassing it", () => {
    useStore.getState().openAnalyzedDocument(
      "/vault/risky.md",
      "A footnote[^one].",
      "disk",
    )
    renderHook(() => useEditorMode())

    const event = new KeyboardEvent("keydown", {
      key: "e",
      metaKey: true,
      cancelable: true,
    })
    act(() => document.dispatchEvent(event))

    expect(event.defaultPrevented).toBe(true)
    expect(useStore.getState().editorMode).toBe("raw")
    expect(useStore.getState().preferredEditorMode).toBe("block")
  })
})
