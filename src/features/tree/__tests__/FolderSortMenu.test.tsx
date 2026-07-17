import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useStore } from "../../../lib/store"
import { FolderSortMenu } from "../FolderSortMenu"

beforeEach(() => {
  useStore.setState({ folderSortPrefs: {} })
})

describe("FolderSortMenu", () => {
  it("lists all four sort options", () => {
    render(<FolderSortMenu x={0} y={0} folderPath="/v/notes" onClose={() => {}} />)
    for (const label of [
      "Name (A → Z)",
      "Name (Z → A)",
      "Date added (newest first)",
      "Date added (oldest first)",
    ]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeTruthy()
    }
  })

  it("stores the picked pref and closes", () => {
    const onClose = vi.fn()
    render(<FolderSortMenu x={0} y={0} folderPath="/v/notes" onClose={onClose} />)
    fireEvent.click(screen.getByRole("menuitem", { name: "Name (Z → A)" }))
    expect(useStore.getState().folderSortPrefs["/v/notes"]).toEqual({ key: "name", dir: "desc" })
    expect(onClose).toHaveBeenCalled()
  })

  it("picking the default clears the stored entry", () => {
    useStore.getState().setFolderSortPref("/v/notes", { key: "name", dir: "asc" })
    render(<FolderSortMenu x={0} y={0} folderPath="/v/notes" onClose={() => {}} />)
    fireEvent.click(screen.getByRole("menuitem", { name: "Date added (newest first)" }))
    expect(useStore.getState().folderSortPrefs["/v/notes"]).toBeUndefined()
  })
})
