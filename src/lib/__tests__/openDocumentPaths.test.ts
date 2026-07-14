import { beforeEach, describe, expect, it } from "vitest"
import { useStore } from "../store"
import {
  pathIsWithin,
  remapOpenDocumentPath,
  removeOpenDocumentPaths,
} from "../openDocumentPaths"

function seedPathState() {
  useStore.getState().openAnalyzedDocument("/vault/notes/draft.md", "# Draft", "disk")
  useStore.setState({
    rootPath: "/vault",
    selectedPath: "/vault/notes/draft.md",
    selectedPaths: new Set(["/vault/notes/draft.md", "/vault/notes-old/keep.md"]),
    expandedFolders: new Set(["/vault/notes", "/vault/notes-old"]),
    pinnedPaths: ["/vault/notes/draft.md", "/vault/notes-old/keep.md"],
    blockModeOverrides: {
      "/vault/notes/draft.md": "fingerprint",
      "/vault/notes-old/keep.md": "other",
    },
    pendingScroll: {
      kind: "vault-reveal",
      path: "/vault/notes/draft.md",
      line: 3,
      matchText: "Draft",
      occurrence: 0,
    },
    blockTextIndex: {
      path: "/vault/notes/draft.md",
      docKey: "/vault/notes/draft.md#2",
      blocks: [{ blockId: "one", text: "Draft" }],
    },
    pendingCursorAtEnd: "/vault/notes/draft.md",
    headingCommittedPath: "/vault/notes/draft.md",
    editorSelection: {
      text: "Draft",
      sourcePath: "/vault/notes/draft.md",
      attached: true,
    },
    loadError: { path: "/vault/notes/draft.md", message: "old error" },
    renamingPath: "/vault/notes/draft.md",
    recentFilesByVault: {
      "/vault": ["/vault/notes/draft.md", "/vault/notes-old/keep.md"],
    },
  })
}

describe("open-document path state", () => {
  beforeEach(() => {
    useStore.setState({
      rootPath: null,
      openDoc: null,
      selectedPath: null,
      selectedPaths: new Set(),
      expandedFolders: new Set(),
      pinnedPaths: [],
      blockModeOverrides: {},
      pendingScroll: null,
      blockTextIndex: null,
      pendingCursorAtEnd: null,
      headingCommittedPath: null,
      editorSelection: null,
      loadError: null,
      renamingPath: null,
      recentFilesByVault: {},
    })
  })

  it("uses path boundaries instead of sibling string prefixes", () => {
    expect(pathIsWithin("/vault/notes", "/vault/notes")).toBe(true)
    expect(pathIsWithin("/vault/notes/draft.md", "/vault/notes")).toBe(true)
    expect(pathIsWithin("/vault/notes-old/keep.md", "/vault/notes")).toBe(false)
    expect(pathIsWithin("/note.md", "/")).toBe(true)
  })

  it("remaps all live path-keyed state in one store update", () => {
    seedPathState()

    remapOpenDocumentPath("/vault/notes", "/vault/archive")

    const s = useStore.getState()
    expect(s.openDoc?.path).toBe("/vault/archive/draft.md")
    expect(s.selectedPath).toBe("/vault/archive/draft.md")
    expect([...s.selectedPaths]).toEqual([
      "/vault/archive/draft.md",
      "/vault/notes-old/keep.md",
    ])
    expect([...s.expandedFolders]).toEqual(["/vault/archive", "/vault/notes-old"])
    expect(s.pinnedPaths).toEqual([
      "/vault/archive/draft.md",
      "/vault/notes-old/keep.md",
    ])
    expect(s.blockModeOverrides).toEqual({
      "/vault/archive/draft.md": "fingerprint",
      "/vault/notes-old/keep.md": "other",
    })
    expect(s.pendingScroll?.path).toBe("/vault/archive/draft.md")
    expect(s.blockTextIndex).toBeNull()
    expect(s.pendingCursorAtEnd).toBe("/vault/archive/draft.md")
    expect(s.headingCommittedPath).toBe("/vault/archive/draft.md")
    expect(s.editorSelection?.sourcePath).toBe("/vault/archive/draft.md")
    expect(s.loadError?.path).toBe("/vault/archive/draft.md")
    expect(s.renamingPath).toBe("/vault/archive/draft.md")
    expect(s.recentFilesByVault["/vault"]).toEqual([
      "/vault/archive/draft.md",
      "/vault/notes-old/keep.md",
    ])
  })

  it("removes only state below successfully deleted roots", () => {
    seedPathState()

    removeOpenDocumentPaths(["/vault/notes"])

    const s = useStore.getState()
    expect(s.openDoc).toBeNull()
    expect(s.selectedPath).toBeNull()
    expect([...s.selectedPaths]).toEqual(["/vault/notes-old/keep.md"])
    expect([...s.expandedFolders]).toEqual(["/vault/notes-old"])
    expect(s.pinnedPaths).toEqual(["/vault/notes-old/keep.md"])
    expect(s.blockModeOverrides).toEqual({ "/vault/notes-old/keep.md": "other" })
    expect(s.pendingScroll).toBeNull()
    expect(s.blockTextIndex).toBeNull()
    expect(s.pendingCursorAtEnd).toBeNull()
    expect(s.headingCommittedPath).toBeNull()
    expect(s.editorSelection).toBeNull()
    expect(s.loadError).toBeNull()
    expect(s.renamingPath).toBeNull()
    expect(s.recentFilesByVault["/vault"]).toEqual(["/vault/notes-old/keep.md"])
  })

  it("remaps stale history when an on-leave rename finishes after a vault switch", () => {
    useStore.setState({
      rootPath: "/new-vault",
      recentFilesByVault: {
        "/old-vault": ["/old-vault/untitled.md"],
        "/new-vault": ["/new-vault/current.md"],
      },
    })

    remapOpenDocumentPath(
      "/old-vault/untitled.md",
      "/old-vault/titled.md",
    )

    expect(useStore.getState().recentFilesByVault).toEqual({
      "/old-vault": ["/old-vault/titled.md"],
      "/new-vault": ["/new-vault/current.md"],
    })
  })
})
