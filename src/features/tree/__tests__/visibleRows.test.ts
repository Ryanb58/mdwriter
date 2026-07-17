import { describe, it, expect } from "vitest"
import type { TreeNode } from "../../../lib/ipc"
import { visibleRows, rangeBetween } from "../visibleRows"

const file = (path: string, created?: number): TreeNode => ({
  kind: "file",
  name: path.split("/").pop()!,
  path,
  ...(created !== undefined ? { created } : {}),
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
    // Dirs always sort first A→Z (drafts before notes) — matching what the
    // tree renders — with files after, so the fixture's raw order is not
    // preserved.
    expect(rows.map((r) => r.path)).toEqual([
      "/root/drafts",
      "/root/notes",
      "/root/notes/a.md",
      "/root/notes/b.md",
      "/root/top.md",
    ])
  })

  it("doesn't include the root itself", () => {
    const tree = dir("/root", [file("/root/a.md")])
    const rows = visibleRows(tree, new Set())
    expect(rows.map((r) => r.path)).toEqual(["/root/a.md"])
  })
})

describe("visibleRows sorting", () => {
  it("orders each folder's files by its own pref, default newest-first", () => {
    const tree = dir("/root", [
      dir("/root/notes", [file("/root/notes/old.md", 100), file("/root/notes/new.md", 200)]),
      file("/root/a.md", 100),
      file("/root/b.md", 200),
    ])
    const expanded = new Set(["/root/notes"])
    // notes pinned to name A→Z; root left on the newest-first default.
    const prefs = { "/root/notes": { key: "name", dir: "asc" } as const }
    const rows = visibleRows(tree, expanded, prefs)
    // notes is name-A→Z (`new.md` < `old.md`); the root default is newest
    // first, so b.md (200) precedes a.md (100).
    expect(rows.map((r) => r.path)).toEqual([
      "/root/notes",
      "/root/notes/new.md",
      "/root/notes/old.md",
      "/root/b.md",
      "/root/a.md",
    ])
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
