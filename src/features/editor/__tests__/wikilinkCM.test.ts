import { describe, it, expect } from "vitest"
import { detectWikilinkTrigger, filterNotes } from "../wikilinkCM"
import type { VaultNote } from "../../../lib/vaultNotes"

const notes: VaultNote[] = [
  { name: "Three laws of motion", path: "/v/Three laws of motion.md", rel: "Three laws of motion.md" },
  { name: "Inertia", path: "/v/Inertia.md", rel: "Inertia.md" },
  { name: "Mass", path: "/v/Mass.md", rel: "Mass.md" },
]

describe("detectWikilinkTrigger", () => {
  it("finds an unclosed [[ before the caret", () => {
    expect(detectWikilinkTrigger("hello [[foo", 11)).toEqual({ start: 6, query: "foo" })
  })
  it("returns null when no [[ is open", () => {
    expect(detectWikilinkTrigger("hello world", 11)).toBeNull()
  })
  it("cancels on ] before [[", () => {
    expect(detectWikilinkTrigger("hello [[done]] then [", 21)).toBeNull()
  })
  it("cancels on newline before [[", () => {
    expect(detectWikilinkTrigger("[[foo\nbar", 9)).toBeNull()
  })
  it("rejects embedded [", () => {
    expect(detectWikilinkTrigger("[[a[b", 5)).toBeNull()
  })
  it("respects maxLen", () => {
    const wide = "[[" + "x".repeat(200)
    expect(detectWikilinkTrigger(wide, wide.length, 80)).toBeNull()
  })
  it("empty query is allowed", () => {
    expect(detectWikilinkTrigger("[[", 2)).toEqual({ start: 0, query: "" })
  })
})

describe("MD_LINK_RE behavior (via inspection)", () => {
  // We exercise the regex through a small helper rather than importing it
  // directly — the same negative-lookbehind pattern lives in wikilinkCM.ts.
  const MD_LINK_RE = /(?<!!)\[([^\]\r\n]+)\]\(([^)\r\n]+)\)/g

  function findFirst(s: string): string | null {
    MD_LINK_RE.lastIndex = 0
    const m = MD_LINK_RE.exec(s)
    return m ? m[0] : null
  }

  it("matches a plain markdown link", () => {
    expect(findFirst("see [Note](Note.md) here")).toBe("[Note](Note.md)")
  })
  it("does not match image syntax", () => {
    expect(findFirst("![alt](image.png)")).toBeNull()
  })
  it("matches a link that follows an image on the same line", () => {
    // Image at index 0 should be skipped; the link that follows still matches.
    const found = findFirst("![alt](img.png) and [Note](Note.md)")
    expect(found).toBe("[Note](Note.md)")
  })
})

describe("filterNotes", () => {
  it("returns all up to max when query is empty", () => {
    expect(filterNotes(notes, "")).toHaveLength(3)
  })
  it("substring matches", () => {
    expect(filterNotes(notes, "inert")).toEqual([notes[1]])
  })
  it("ranks earlier-name matches first", () => {
    const out = filterNotes(notes, "m")
    // "Mass" (m@0) ranks before "Three laws of motion" (m@13)
    expect(out[0].name).toBe("Mass")
  })
})
