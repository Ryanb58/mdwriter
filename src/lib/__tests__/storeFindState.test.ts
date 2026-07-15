import { beforeEach, describe, expect, it } from "vitest"
import { useStore } from "../store"

describe("ephemeral block Find index", () => {
  beforeEach(() => {
    useStore.setState({ blockTextIndex: null })
  })

  it("publishes and clears the rendered index through one store action", () => {
    const index = {
      path: "/vault/note.md",
      docKey: "/vault/note.md#3",
      blocks: [{ blockId: "a", text: "Visible text" }],
    }

    useStore.getState().setBlockTextIndex(index)
    expect(useStore.getState().blockTextIndex).toEqual(index)

    useStore.getState().setBlockTextIndex(null)
    expect(useStore.getState().blockTextIndex).toBeNull()
  })
})
