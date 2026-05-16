import { describe, it, expect } from "vitest"
import { flattenNotes } from "../vaultNotes"
import type { TreeNode } from "../ipc"

describe("flattenNotes", () => {
  it("carries mtime from tree files through to vault notes", () => {
    const tree: TreeNode = {
      kind: "dir",
      name: "vault",
      path: "/vault",
      children: [
        { kind: "file", name: "old.md", path: "/vault/old.md", mtime: 100 },
        { kind: "file", name: "new.md", path: "/vault/new.md", mtime: 200 },
      ],
    }
    const notes = flattenNotes(tree, "/vault")
    expect(notes).toHaveLength(2)
    const byName = Object.fromEntries(notes.map((n) => [n.name, n]))
    expect(byName.old.mtime).toBe(100)
    expect(byName.new.mtime).toBe(200)
  })

  it("leaves mtime undefined when the tree node omits it", () => {
    const tree: TreeNode = {
      kind: "dir",
      name: "vault",
      path: "/vault",
      children: [{ kind: "file", name: "a.md", path: "/vault/a.md" }],
    }
    const [note] = flattenNotes(tree, "/vault")
    expect(note.mtime).toBeUndefined()
  })
})
