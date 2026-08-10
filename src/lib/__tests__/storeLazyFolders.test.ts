import { beforeEach, describe, expect, it } from "vitest"
import { useStore } from "../store"

describe("lazy folder request state", () => {
  beforeEach(() => {
    useStore.setState({ loadingFolders: new Set(), folderLoadErrors: {} })
  })

  it("tracks loading independently for each folder", () => {
    const state = useStore.getState()

    state.setFolderLoading("/vault/a", true)
    state.setFolderLoading("/vault/b", true)
    state.setFolderLoading("/vault/a", false)

    expect(useStore.getState().loadingFolders).toEqual(new Set(["/vault/b"]))
  })

  it("sets and clears one folder error without disturbing another", () => {
    const state = useStore.getState()

    state.setFolderLoadError("/vault/a", "offline")
    state.setFolderLoadError("/vault/b", "permission denied")
    state.setFolderLoadError("/vault/a", null)

    expect(useStore.getState().folderLoadErrors).toEqual({
      "/vault/b": "permission denied",
    })
  })

  it("clears all transient folder request state", () => {
    const state = useStore.getState()
    state.setFolderLoading("/vault/a", true)
    state.setFolderLoadError("/vault/a", "offline")

    state.clearFolderLoadState()

    expect(useStore.getState().loadingFolders).toEqual(new Set())
    expect(useStore.getState().folderLoadErrors).toEqual({})
  })
})
