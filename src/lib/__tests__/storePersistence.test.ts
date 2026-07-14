import { beforeEach, describe, expect, it } from "vitest"
import { useStore } from "../store"

describe("store persistence boundaries", () => {
  beforeEach(() => {
    localStorage.removeItem("mdwriter:store")
    useStore.setState({
      openDoc: null,
      editorMode: "block",
      preferredEditorMode: "block",
      blockModeOverrides: {},
      loadError: null,
      selectedPath: null,
      rightPaneTab: "properties",
    })
  })

  it("drops legacy editor session state while restoring allowed preferences", async () => {
    localStorage.setItem("mdwriter:store", JSON.stringify({
      state: {
        rightPaneTab: "ai",
        editorMode: "raw",
        preferredEditorMode: "raw",
        blockModeOverrides: { "/vault/risky.md": "old-fingerprint" },
        loadError: { path: "/vault/missing.md", message: "old error" },
        openDoc: { path: "/vault/stale.md", text: "stale bytes" },
        selectedPath: "/vault/stale.md",
      },
      version: 0,
    }))

    await useStore.persist.rehydrate()

    expect(useStore.getState()).toMatchObject({
      rightPaneTab: "ai",
      editorMode: "block",
      preferredEditorMode: "block",
      blockModeOverrides: {},
      loadError: null,
      openDoc: null,
      selectedPath: null,
    })
  })
})
