import { describe, it, expect } from "vitest"
import { pruneSubpaths, isUnderAny } from "../pruneSubpaths"

describe("pruneSubpaths", () => {
  it("returns input unchanged when no path is a descendant of another", () => {
    const out = pruneSubpaths(["/a/x.md", "/b/y.md", "/c"])
    expect(out.sort()).toEqual(["/a/x.md", "/b/y.md", "/c"])
  })

  it("drops descendants when an ancestor is also in the set", () => {
    const out = pruneSubpaths(["/vault/notes", "/vault/notes/a.md", "/vault/notes/sub/b.md"])
    expect(out).toEqual(["/vault/notes"])
  })

  it("keeps siblings even when one of them is a nested dir", () => {
    const out = pruneSubpaths(["/vault/notes", "/vault/drafts/d.md"])
    expect(out.sort()).toEqual(["/vault/drafts/d.md", "/vault/notes"])
  })

  it("does not treat path-prefix matches across boundaries as descendants", () => {
    // "/vault/notes-archive" is not under "/vault/notes" even though the
    // string is a prefix — the separator check prevents the false positive.
    const out = pruneSubpaths(["/vault/notes", "/vault/notes-archive"])
    expect(out.sort()).toEqual(["/vault/notes", "/vault/notes-archive"])
  })

  it("handles Windows-style separators", () => {
    const out = pruneSubpaths(["C:\\vault\\notes", "C:\\vault\\notes\\a.md"])
    expect(out).toEqual(["C:\\vault\\notes"])
  })

  it("dedupes identical paths", () => {
    const out = pruneSubpaths(["/a.md", "/a.md", "/b.md"])
    expect(out.sort()).toEqual(["/a.md", "/b.md"])
  })
})

describe("isUnderAny", () => {
  it("returns true for exact match", () => {
    expect(isUnderAny("/vault/a.md", ["/vault/a.md"])).toBe(true)
  })

  it("returns true for a path under a directory in the set", () => {
    expect(isUnderAny("/vault/notes/a.md", ["/vault/notes"])).toBe(true)
  })

  it("returns false for sibling paths sharing a prefix", () => {
    expect(isUnderAny("/vault/notes-archive/a.md", ["/vault/notes"])).toBe(false)
  })

  it("returns false when nothing matches", () => {
    expect(isUnderAny("/vault/a.md", ["/vault/b.md", "/vault/sub"])).toBe(false)
  })
})
