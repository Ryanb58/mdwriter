import { describe, it, expect } from "vitest"
import type { TreeNode } from "../../../lib/ipc"
import { sortChildren, DEFAULT_FOLDER_SORT, sameSort } from "../sortChildren"

const file = (name: string, times?: { mtime?: number; created?: number }): TreeNode => ({
  kind: "file",
  name,
  path: `/v/${name}`,
  ...times,
})

const dir = (name: string): TreeNode => ({ kind: "dir", name, path: `/v/${name}`, children: [] })

const names = (nodes: TreeNode[]) => nodes.map((n) => n.name)

describe("sortChildren", () => {
  it("defaults to date added, newest first", () => {
    expect(sameSort(DEFAULT_FOLDER_SORT, { key: "added", dir: "desc" })).toBe(true)
    const out = sortChildren([
      file("old.md", { created: 100 }),
      file("new.md", { created: 300 }),
      file("mid.md", { created: 200 }),
    ])
    expect(names(out)).toEqual(["new.md", "mid.md", "old.md"])
  })

  it("always puts folders first, A→Z, regardless of pref", () => {
    const out = sortChildren(
      [file("a.md", { created: 999 }), dir("zeta"), dir("Alpha")],
      { key: "name", dir: "desc" },
    )
    expect(names(out)).toEqual(["Alpha", "zeta", "a.md"])
  })

  it("sorts by name ascending and descending, case-insensitively", () => {
    const files = [file("banana.md"), file("Apple.md"), file("cherry.md")]
    expect(names(sortChildren(files, { key: "name", dir: "asc" })))
      .toEqual(["Apple.md", "banana.md", "cherry.md"])
    expect(names(sortChildren(files, { key: "name", dir: "desc" })))
      .toEqual(["cherry.md", "banana.md", "Apple.md"])
  })

  it("sorts by date added ascending (oldest first)", () => {
    const out = sortChildren(
      [file("b.md", { created: 200 }), file("a.md", { created: 100 })],
      { key: "added", dir: "asc" },
    )
    expect(names(out)).toEqual(["a.md", "b.md"])
  })

  it("falls back created → mtime → 0", () => {
    const out = sortChildren([
      file("no-times.md"),
      file("mtime-only.md", { mtime: 500 }),
      file("created.md", { created: 400, mtime: 1 }),
    ])
    // desc: mtime-only(500) > created(400) > no-times(0)
    expect(names(out)).toEqual(["mtime-only.md", "created.md", "no-times.md"])
  })

  it("breaks timestamp ties by name ascending", () => {
    const out = sortChildren(
      [file("b.md", { created: 100 }), file("a.md", { created: 100 })],
      { key: "added", dir: "desc" },
    )
    expect(names(out)).toEqual(["a.md", "b.md"])
  })

  it("does not mutate its input", () => {
    const input = [file("b.md"), file("a.md")]
    const copy = [...input]
    sortChildren(input, { key: "name", dir: "asc" })
    expect(input).toEqual(copy)
  })
})
