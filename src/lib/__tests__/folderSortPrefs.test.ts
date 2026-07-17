import { describe, it, expect, beforeEach } from "vitest"
import { useStore } from "../store"

beforeEach(() => {
  useStore.setState({ folderSortPrefs: {} })
})

describe("setFolderSortPref", () => {
  it("stores a non-default preference", () => {
    useStore.getState().setFolderSortPref("/v/notes", { key: "name", dir: "asc" })
    expect(useStore.getState().folderSortPrefs).toEqual({
      "/v/notes": { key: "name", dir: "asc" },
    })
  })

  it("keeps independent prefs per folder", () => {
    const s = useStore.getState()
    s.setFolderSortPref("/v/a", { key: "name", dir: "asc" })
    s.setFolderSortPref("/v/b", { key: "added", dir: "asc" })
    expect(Object.keys(useStore.getState().folderSortPrefs).sort()).toEqual(["/v/a", "/v/b"])
  })

  it("choosing the default removes the entry instead of storing it", () => {
    useStore.getState().setFolderSortPref("/v/notes", { key: "name", dir: "desc" })
    useStore.getState().setFolderSortPref("/v/notes", { key: "added", dir: "desc" })
    expect(useStore.getState().folderSortPrefs).toEqual({})
  })

  it("null clears the entry", () => {
    useStore.getState().setFolderSortPref("/v/notes", { key: "name", dir: "asc" })
    useStore.getState().setFolderSortPref("/v/notes", null)
    expect(useStore.getState().folderSortPrefs).toEqual({})
  })

  it("no-ops when clearing a folder that has no entry", () => {
    const before = useStore.getState().folderSortPrefs
    useStore.getState().setFolderSortPref("/v/none", null)
    expect(useStore.getState().folderSortPrefs).toBe(before)
  })
})
