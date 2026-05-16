import { describe, expect, it } from "vitest"
import { diffLines } from "../lineDiff"

describe("diffLines", () => {
  it("returns all-equal when inputs match", () => {
    const out = diffLines("a\nb\nc", "a\nb\nc")
    expect(out).toEqual([
      { kind: "equal", text: "a" },
      { kind: "equal", text: "b" },
      { kind: "equal", text: "c" },
    ])
  })

  it("marks additions at the end", () => {
    const out = diffLines("a\nb", "a\nb\nc")
    expect(out).toEqual([
      { kind: "equal", text: "a" },
      { kind: "equal", text: "b" },
      { kind: "add", text: "c" },
    ])
  })

  it("marks removals from the middle", () => {
    const out = diffLines("a\nb\nc", "a\nc")
    expect(out).toEqual([
      { kind: "equal", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "equal", text: "c" },
    ])
  })

  it("ignores a trailing newline difference", () => {
    expect(diffLines("a\nb\n", "a\nb")).toEqual([
      { kind: "equal", text: "a" },
      { kind: "equal", text: "b" },
    ])
  })

  it("handles a full rewrite", () => {
    const out = diffLines("old", "new")
    expect(out).toEqual([
      { kind: "remove", text: "old" },
      { kind: "add", text: "new" },
    ])
  })
})
