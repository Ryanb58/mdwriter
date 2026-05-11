import { describe, expect, it } from "vitest"
import {
  applyWikilinkSelection,
  detectAtTrigger,
  detectMentionTrigger,
  detectWikilinkTrigger,
} from "../wikilinkDetect"

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

describe("detectAtTrigger", () => {
  it("returns null for empty input", () => {
    expect(detectAtTrigger("", 0)).toBeNull()
  })

  it("matches @ at the start of the input", () => {
    const t = detectAtTrigger("@note", 5)
    expect(t).toEqual({ start: 0, end: 5, query: "note" })
  })

  it("matches @ after a space", () => {
    const t = detectAtTrigger("see @note", 9)
    expect(t).toEqual({ start: 4, end: 9, query: "note" })
  })

  it("matches @ with empty query", () => {
    const t = detectAtTrigger("ask about @", 11)
    expect(t).toEqual({ start: 10, end: 11, query: "" })
  })

  it("rejects @ inside an email-like token", () => {
    expect(detectAtTrigger("user@host", 9)).toBeNull()
  })

  it("rejects @ after a letter", () => {
    expect(detectAtTrigger("foo@bar", 7)).toBeNull()
  })

  it("allows @ after an opening bracket", () => {
    expect(detectAtTrigger("(@note", 6)).toEqual({ start: 1, end: 6, query: "note" })
  })

  it("cancels on whitespace inside the query", () => {
    expect(detectAtTrigger("@a b", 4)).toBeNull()
  })

  it("cancels on newline inside the query", () => {
    expect(detectAtTrigger("@a\nb", 4)).toBeNull()
  })

  it("respects maxLen", () => {
    const text = "@" + "a".repeat(100)
    expect(detectAtTrigger(text, text.length, 60)).toBeNull()
  })
})

describe("detectMentionTrigger", () => {
  it("returns null when neither form is open", () => {
    expect(detectMentionTrigger("nothing here", 12)).toBeNull()
  })

  it("returns the [[ trigger when only that is open", () => {
    expect(detectMentionTrigger("[[note", 6)?.start).toBe(0)
  })

  it("returns the @ trigger when only that is open", () => {
    expect(detectMentionTrigger("see @note", 9)?.start).toBe(4)
  })

  it("prefers the trigger closer to the caret when both could match", () => {
    // `[[` opens at 0; later, an unfinished `@no` opens at 12.
    const t = detectMentionTrigger("[[orphan and @no", 16)
    expect(t?.start).toBe(13)
    expect(t?.query).toBe("no")
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

  it("replaces an @ trigger with a wikilink", () => {
    const r = applyWikilinkSelection(
      "see @note",
      { start: 4, end: 9, query: "note" },
      "my-note",
    )
    expect(r.value).toBe("see [[my-note]]")
    expect(r.caret).toBe("see [[my-note]]".length)
  })
})
