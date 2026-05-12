import { describe, it, expect } from "vitest"
import type { TreeNode } from "../../../lib/ipc"
import { targetParentDir } from "../targetDir"

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

describe("targetParentDir", () => {
  const root = "/vault"
  const tree = dir("/vault", [
    dir("/vault/notes", [
      file("/vault/notes/a.md"),
      dir("/vault/notes/drafts", [file("/vault/notes/drafts/x.md")]),
    ]),
    file("/vault/top.md"),
  ])

  it("returns null when no vault is open", () => {
    expect(targetParentDir(null, null, null)).toBeNull()
    expect(targetParentDir(tree, "/vault/top.md", null)).toBeNull()
  })

  it("falls back to the root when nothing is selected", () => {
    expect(targetParentDir(tree, null, root)).toBe(root)
  })

  it("returns the selected folder itself", () => {
    expect(targetParentDir(tree, "/vault/notes", root)).toBe("/vault/notes")
    expect(targetParentDir(tree, "/vault/notes/drafts", root)).toBe("/vault/notes/drafts")
  })

  it("returns the parent of a selected file", () => {
    expect(targetParentDir(tree, "/vault/notes/a.md", root)).toBe("/vault/notes")
    expect(targetParentDir(tree, "/vault/notes/drafts/x.md", root)).toBe("/vault/notes/drafts")
  })

  it("returns the vault root for a file sitting at the vault root", () => {
    expect(targetParentDir(tree, "/vault/top.md", root)).toBe("/vault")
  })

  it("falls back to root when the selection no longer exists in the tree", () => {
    expect(targetParentDir(tree, "/vault/deleted.md", root)).toBe(root)
  })
})
