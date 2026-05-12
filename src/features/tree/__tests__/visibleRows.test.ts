import { describe, it, expect } from "vitest"
import type { TreeNode } from "../../../lib/ipc"
import { visibleRows, rangeBetween } from "../visibleRows"

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

describe("visibleRows", () => {
  it("returns an empty list for null tree", () => {
    expect(visibleRows(null, new Set())).toEqual([])
  })

  it("walks expanded folders but skips collapsed ones", () => {
    const tree = dir("/root", [
      dir("/root/notes", [file("/root/notes/a.md"), file("/root/notes/b.md")]),
      dir("/root/drafts", [file("/root/drafts/c.md")]),
      file("/root/top.md"),
    ])
    const expanded = new Set(["/root/notes"])
    const rows = visibleRows(tree, expanded)
    expect(rows.map((r) => r.path)).toEqual([
      "/root/notes",
      "/root/notes/a.md",
      "/root/notes/b.md",
      "/root/drafts",
      "/root/top.md",
    ])
  })

  it("doesn't include the root itself", () => {
    const tree = dir("/root", [file("/root/a.md")])
    const rows = visibleRows(tree, new Set())
    expect(rows.map((r) => r.path)).toEqual(["/root/a.md"])
  })
})

describe("rangeBetween", () => {
  const rows: TreeNode[] = [file("/a"), file("/b"), file("/c"), file("/d")]

  it("returns inclusive range in forward order", () => {
    expect(rangeBetween(rows, "/b", "/d").map((r) => r.path)).toEqual(["/b", "/c", "/d"])
  })

  it("returns inclusive range in reverse order", () => {
    expect(rangeBetween(rows, "/d", "/b").map((r) => r.path)).toEqual(["/b", "/c", "/d"])
  })

  it("returns single-row range when from == to", () => {
    expect(rangeBetween(rows, "/c", "/c").map((r) => r.path)).toEqual(["/c"])
  })

  it("returns empty when either endpoint is missing", () => {
    expect(rangeBetween(rows, "/missing", "/b")).toEqual([])
    expect(rangeBetween(rows, "/a", "/missing")).toEqual([])
  })
})
