import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { TreeNode } from "../../../lib/ipc"

const harness = vi.hoisted(() => ({ loadDirectory: vi.fn() }))

vi.mock("../treeLoader", () => ({ loadDirectory: harness.loadDirectory }))
vi.mock("../useTreeActions", () => ({
  useTreeActions: () => ({
    newFile: vi.fn(),
    newFolder: vi.fn(),
    rename: vi.fn(),
    trash: vi.fn(),
    trashMany: vi.fn(),
  }),
}))
vi.mock("../useTreeDnd", () => ({
  useRowDnd: () => ({
    isDropTarget: false,
    isDragging: false,
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
  }),
}))

import { useStore } from "../../../lib/store"
import { TreeNodeView } from "../TreeNode"

const unloaded: TreeNode = {
  kind: "dir",
  name: "notes",
  path: "/vault/notes",
  children: [],
  loaded: false,
}

describe("TreeNodeView lazy directories", () => {
  beforeEach(() => {
    harness.loadDirectory.mockReset()
    harness.loadDirectory.mockResolvedValue("loaded")
    useStore.setState({
      rootPath: "/vault",
      tree: {
        kind: "dir",
        name: "vault",
        path: "/vault",
        children: [unloaded],
        loaded: true,
      },
      selectedPath: null,
      selectedPaths: new Set(),
      expandedFolders: new Set(),
      loadingFolders: new Set(),
      folderLoadErrors: {},
      pinnedPaths: [],
      renamingPath: null,
    })
  })

  it("loads an unloaded directory on first expansion", () => {
    render(<TreeNodeView node={unloaded} />)

    fireEvent.click(screen.getByText("notes"))

    expect(useStore.getState().expandedFolders).toContain("/vault/notes")
    expect(harness.loadDirectory).toHaveBeenCalledWith("/vault/notes")
  })

  it("does not reload an already loaded directory", () => {
    render(<TreeNodeView node={{ ...unloaded, loaded: true }} />)

    fireEvent.click(screen.getByText("notes"))

    expect(harness.loadDirectory).not.toHaveBeenCalled()
  })

  it("shows local loading and retry rows", () => {
    useStore.setState({
      expandedFolders: new Set(["/vault/notes"]),
      loadingFolders: new Set(["/vault/notes"]),
      folderLoadErrors: { "/vault/notes": "offline" },
    })
    const { rerender } = render(<TreeNodeView node={unloaded} />)
    expect(screen.getByText("Loading…")).toBeInTheDocument()

    useStore.setState({ loadingFolders: new Set() })
    rerender(<TreeNodeView node={unloaded} />)
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    expect(harness.loadDirectory).toHaveBeenCalledWith("/vault/notes")
  })
})
