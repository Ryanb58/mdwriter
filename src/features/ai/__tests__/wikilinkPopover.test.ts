import { describe, expect, it } from "vitest"
import { __test__ } from "../WikilinkPopover"
import type { VaultNote } from "../../../lib/vaultNotes"

const { filterNotes } = __test__

function n(name: string, mtime: number | undefined = 0, rel?: string): VaultNote {
  return {
    name,
    path: `/vault/${rel ?? name}.md`,
    rel: rel ?? `${name}.md`,
    mtime,
  }
}

describe("filterNotes", () => {
  it("sorts newest-first when there's no query", () => {
    const notes = [n("old", 100), n("middle", 500), n("newest", 900)]
    expect(filterNotes(notes, "")).toEqual([
      notes[2], // newest
      notes[1], // middle
      notes[0], // old
    ])
  })

  it("treats blank-whitespace query as no query", () => {
    const notes = [n("a", 1), n("b", 9)]
    expect(filterNotes(notes, "   ")).toEqual([notes[1], notes[0]])
  })

  it("sinks notes without mtime to the bottom", () => {
    const notes = [n("old", 1), n("undated", undefined), n("recent", 100)]
    expect(filterNotes(notes, "")).toEqual([notes[2], notes[0], notes[1]])
  })

  it("breaks score ties by recency when a query is present", () => {
    // Both have name-index 0 → equal score. mtime decides.
    const a = n("alpha", 100)
    const b = n("alphabet", 900)
    expect(filterNotes([a, b], "alpha")).toEqual([b, a])
  })

  it("prefers name matches over path matches", () => {
    const byName = n("alpha", 100)
    const byPath = n("zulu", 900, "alpha/zulu.md")
    expect(filterNotes([byPath, byName], "alpha")).toEqual([byName, byPath])
  })

  it("filters out non-matching notes", () => {
    const notes = [n("alpha", 100), n("beta", 200), n("gamma", 300)]
    expect(filterNotes(notes, "alp")).toEqual([notes[0]])
  })
})
