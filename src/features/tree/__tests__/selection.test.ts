import { describe, it, expect, beforeEach } from "vitest"
import type { TreeNode } from "../../../lib/ipc"
import { useStore } from "../../../lib/store"
import { handleRowClick, collapseSelectionToAnchor } from "../selection"

const file = (path: string): TreeNode => ({
  kind: "file",
  name: path.split("/").pop()!,
  path,
})

const dir = (path: string, children: TreeNode[]): TreeNode => ({
  kind: "dir",
  name: path.split("/").pop()!,
  path,
  children,
})

const tree = dir("/root", [
  dir("/root/notes", [file("/root/notes/a.md"), file("/root/notes/b.md")]),
  file("/root/c.md"),
  file("/root/d.md"),
])

function resetStore() {
  useStore.setState({
    tree,
    expandedFolders: new Set(["/root/notes"]),
    selectedPath: null,
    selectedPaths: new Set(),
  })
}

describe("handleRowClick", () => {
  beforeEach(resetStore)

  it("plain click replaces selection with the clicked row", () => {
    useStore.setState({ selectedPath: "/root/c.md", selectedPaths: new Set(["/root/c.md", "/root/d.md"]) })
    handleRowClick("/root/notes/a.md", { meta: false, shift: false })
    const s = useStore.getState()
    expect(s.selectedPath).toBe("/root/notes/a.md")
    expect(Array.from(s.selectedPaths)).toEqual(["/root/notes/a.md"])
  })

  it("Cmd-click toggles into the selection and updates anchor", () => {
    handleRowClick("/root/c.md", { meta: false, shift: false })
    handleRowClick("/root/d.md", { meta: true, shift: false })
    const s = useStore.getState()
    expect(s.selectedPath).toBe("/root/d.md")
    expect(new Set(s.selectedPaths)).toEqual(new Set(["/root/c.md", "/root/d.md"]))
  })

  it("Cmd-click on anchor removes it and picks a new anchor in visible-row order", () => {
    handleRowClick("/root/c.md", { meta: false, shift: false })
    handleRowClick("/root/d.md", { meta: true, shift: false })
    handleRowClick("/root/d.md", { meta: true, shift: false }) // remove
    const s = useStore.getState()
    expect(s.selectedPath).toBe("/root/c.md")
    expect(new Set(s.selectedPaths)).toEqual(new Set(["/root/c.md"]))
  })

  it("Cmd-click on only selected row empties the selection", () => {
    handleRowClick("/root/c.md", { meta: false, shift: false })
    handleRowClick("/root/c.md", { meta: true, shift: false })
    const s = useStore.getState()
    expect(s.selectedPath).toBeNull()
    expect(s.selectedPaths.size).toBe(0)
  })

  it("Shift-click extends range from anchor in visible-row order", () => {
    handleRowClick("/root/notes/a.md", { meta: false, shift: false })
    handleRowClick("/root/c.md", { meta: false, shift: true })
    const s = useStore.getState()
    expect(s.selectedPath).toBe("/root/notes/a.md") // anchor unchanged
    expect(new Set(s.selectedPaths)).toEqual(
      new Set(["/root/notes/a.md", "/root/notes/b.md", "/root/c.md"]),
    )
  })

  it("Shift-click works backwards across the tree", () => {
    handleRowClick("/root/d.md", { meta: false, shift: false })
    handleRowClick("/root/notes/a.md", { meta: false, shift: true })
    const s = useStore.getState()
    expect(new Set(s.selectedPaths)).toEqual(
      new Set(["/root/notes/a.md", "/root/notes/b.md", "/root/c.md", "/root/d.md"]),
    )
  })
})

describe("collapseSelectionToAnchor", () => {
  beforeEach(resetStore)

  it("collapses a multi-selection back to the anchor", () => {
    handleRowClick("/root/c.md", { meta: false, shift: false })
    handleRowClick("/root/d.md", { meta: true, shift: false })
    expect(useStore.getState().selectedPaths.size).toBe(2)
    expect(collapseSelectionToAnchor()).toBe(true)
    const s = useStore.getState()
    expect(s.selectedPath).toBe("/root/d.md")
    expect(Array.from(s.selectedPaths)).toEqual(["/root/d.md"])
  })

  it("is a no-op when at most one row is selected", () => {
    handleRowClick("/root/c.md", { meta: false, shift: false })
    expect(collapseSelectionToAnchor()).toBe(false)
  })
})
