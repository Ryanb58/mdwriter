import { describe, it, expect } from "vitest"
import { findOccurrences, findRanges, lineAt, wrapIndex } from "../findInText"

describe("findOccurrences", () => {
  it("returns start offsets in document order", () => {
    expect(findOccurrences("abc abc abc", "abc")).toEqual([0, 4, 8])
  })

  it("matches case-insensitively in both directions", () => {
    expect(findOccurrences("Hello hello HELLO", "hello")).toEqual([0, 6, 12])
    expect(findOccurrences("hello", "HeLLo")).toEqual([0])
  })

  it("returns no matches for an empty query", () => {
    expect(findOccurrences("anything", "")).toEqual([])
  })

  it("returns no matches when the needle is absent", () => {
    expect(findOccurrences("abc", "xyz")).toEqual([])
  })

  it("does not count overlapping matches (mirrors editor walkers)", () => {
    // "aaaa" contains "aa" at 0,1,2 overlapping — the editors stride by
    // needle length, so only 0 and 2 count.
    expect(findOccurrences("aaaa", "aa")).toEqual([0, 2])
  })

  it("matches across multibyte text", () => {
    expect(findOccurrences("héllo héllo", "héllo")).toEqual([0, 6])
  })
})

describe("findRanges", () => {
  it("returns exact source ranges for raw-mode highlighting", () => {
    expect(findRanges("one TWO two", "two")).toEqual([
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ])
  })

  it("uses the same non-overlapping semantics as findOccurrences", () => {
    expect(findRanges("aaaa", "aa")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ])
  })

  it("maps Unicode case-folded matches back to original UTF-16 offsets", () => {
    expect(findRanges("İB", "b")).toEqual([{ from: 1, to: 2 }])
    expect(findOccurrences("İB", "b")).toEqual([1])
  })
})

describe("lineAt", () => {
  const text = "first\nsecond\nthird"

  it("is 1-based: offsets on the first line report line 1", () => {
    expect(lineAt(text, 0)).toBe(1)
    expect(lineAt(text, 4)).toBe(1)
  })

  it("reports the line containing the offset", () => {
    expect(lineAt(text, 6)).toBe(2) // 's' of "second"
    expect(lineAt(text, 13)).toBe(3) // 't' of "third"
  })

  it("clamps out-of-range offsets", () => {
    expect(lineAt(text, -5)).toBe(1)
    expect(lineAt(text, 9999)).toBe(3)
  })

  it("pairs with findOccurrences to locate matches by line", () => {
    const occ = findOccurrences(text, "ir")
    expect(occ.map((p) => lineAt(text, p))).toEqual([1, 3])
  })
})

describe("wrapIndex", () => {
  it("passes through in-range indices", () => {
    expect(wrapIndex(0, 3)).toBe(0)
    expect(wrapIndex(2, 3)).toBe(2)
  })

  it("wraps forward past the end", () => {
    expect(wrapIndex(3, 3)).toBe(0)
    expect(wrapIndex(4, 3)).toBe(1)
  })

  it("wraps backward below zero", () => {
    expect(wrapIndex(-1, 3)).toBe(2)
    expect(wrapIndex(-4, 3)).toBe(2)
  })

  it("returns 0 when there are no matches", () => {
    expect(wrapIndex(5, 0)).toBe(0)
    expect(wrapIndex(-1, 0)).toBe(0)
  })
})
