import { describe, expect, it } from "vitest"
import { applyWikilinkSelection, detectWikilinkTrigger } from "../wikilinkDetect"

describe("detectWikilinkTrigger", () => {
  it("returns null for empty input", () => {
    expect(detectWikilinkTrigger("", 0)).toBeNull()
  })

  it("returns null when there's no [[", () => {
    expect(detectWikilinkTrigger("hello world", 5)).toBeNull()
  })

  it("returns null when only one [", () => {
    expect(detectWikilinkTrigger("[note", 5)).toBeNull()
  })

  it("matches an open [[ with empty query", () => {
    const t = detectWikilinkTrigger("ask about [[", 12)
    expect(t).toEqual({ start: 10, end: 12, query: "" })
  })

  it("matches an open [[ with partial query", () => {
    const t = detectWikilinkTrigger("see [[note", 10)
    expect(t).toEqual({ start: 4, end: 10, query: "note" })
  })

  it("cancels after ]]", () => {
    expect(detectWikilinkTrigger("see [[note]] then ", 18)).toBeNull()
  })

  it("cancels after a newline", () => {
    expect(detectWikilinkTrigger("[[note\nmore", 11)).toBeNull()
  })

  it("cancels when query contains a stray [", () => {
    expect(detectWikilinkTrigger("[[note[a", 8)).toBeNull()
  })

  it("respects maxLen", () => {
    const text = "[[" + "a".repeat(200)
    expect(detectWikilinkTrigger(text, text.length, 80)).toBeNull()
  })

  it("finds the closest [[ when multiple exist", () => {
    const t = detectWikilinkTrigger("[[first]] and [[sec", 19)
    expect(t).toEqual({ start: 14, end: 19, query: "sec" })
  })
})

describe("applyWikilinkSelection", () => {
  it("replaces the open [[ with a complete wikilink", () => {
    const r = applyWikilinkSelection(
      "see [[note",
      { start: 4, end: 10, query: "note" },
      "my-note",
    )
    expect(r.value).toBe("see [[my-note]]")
    expect(r.caret).toBe("see [[my-note]]".length)
  })

  it("preserves text after the caret", () => {
    const r = applyWikilinkSelection(
      "before [[no after",
      { start: 7, end: 11, query: "no" },
      "x",
    )
    expect(r.value).toBe("before [[x]] after")
    expect(r.caret).toBe("before [[x]]".length)
  })
})
