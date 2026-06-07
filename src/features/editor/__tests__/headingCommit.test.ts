import { describe, it, expect } from "vitest"
import { headingCommitted } from "../headingCommit"

const h1 = { type: "heading", id: "h1", props: { level: 1 } }
const h2 = { type: "heading", id: "h2", props: { level: 2 } }
const para = (id: string) => ({ type: "paragraph", id, props: {} })

describe("headingCommitted", () => {
  it("is false for a lone H1, cursor inside it (still typing the title)", () => {
    expect(headingCommitted([h1], "h1")).toBe(false)
  })

  it("is false when a block exists after the H1 but the cursor is still in the heading", () => {
    // BlockNote may keep a trailing block; while the cursor is in the heading
    // the user is still typing the title, so we must not commit.
    expect(headingCommitted([h1, para("p1")], "h1")).toBe(false)
  })

  it("is true once the cursor has left the heading (Enter pressed)", () => {
    expect(headingCommitted([h1, para("p1")], "p1")).toBe(true)
  })

  it("falls back to block-after-heading when the cursor is unknown", () => {
    expect(headingCommitted([h1, para("p1")], null)).toBe(true)
    expect(headingCommitted([h1], null)).toBe(false)
  })

  it("is false when there is no level-1 heading", () => {
    expect(headingCommitted([h2, para("p1")], "p1")).toBe(false)
    expect(headingCommitted([para("p1")], "p1")).toBe(false)
  })

  it("is false for an empty document", () => {
    expect(headingCommitted([], null)).toBe(false)
  })

  it("only counts blocks after the H1, not before", () => {
    expect(headingCommitted([para("p0"), h1], "h1")).toBe(false)
  })
})
