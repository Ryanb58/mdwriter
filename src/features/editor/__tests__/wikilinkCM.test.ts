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
