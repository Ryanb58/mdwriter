import { describe, it, expect } from "vitest"
import { basename, parent, joinPath, isMarkdown } from "../paths"

describe("paths", () => {
  it("basename returns last segment", () => {
    expect(basename("/a/b/c.md")).toBe("c.md")
    expect(basename("c.md")).toBe("c.md")
  })

  it("parent returns parent dir", () => {
    expect(parent("/a/b/c.md")).toBe("/a/b")
    expect(parent("/a")).toBe("")
  })

  it("joinPath joins with separator", () => {
    expect(joinPath("/a/b", "c.md")).toBe("/a/b/c.md")
    expect(joinPath("/a/b/", "c.md")).toBe("/a/b/c.md")
  })

  it("isMarkdown detects md extensions", () => {
    expect(isMarkdown("a.md")).toBe(true)
    expect(isMarkdown("a.markdown")).toBe(true)
    expect(isMarkdown("a.txt")).toBe(false)
  })
})
