import { describe, it, expect } from "vitest"
import { basename, parent, joinPath, isMarkdown, relativeTo } from "../paths"

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

  describe("relativeTo", () => {
    it("returns path under root", () => {
      expect(relativeTo("/vault", "/vault/notes/a.md")).toBe("notes/a.md")
    })

    it("returns empty string when path equals root", () => {
      expect(relativeTo("/vault", "/vault")).toBe("")
    })

    it("strips trailing separator on root", () => {
      expect(relativeTo("/vault/", "/vault/a.md")).toBe("a.md")
    })

    it("returns path unchanged when outside root", () => {
      expect(relativeTo("/vault", "/other/a.md")).toBe("/other/a.md")
    })

    it("does not match sibling sharing a prefix", () => {
      // "/vault-2/a.md" must not be mistaken for a child of "/vault"
      expect(relativeTo("/vault", "/vault-2/a.md")).toBe("/vault-2/a.md")
    })

    it("supports windows-style backslash separators", () => {
      expect(relativeTo("C:\\vault", "C:\\vault\\notes\\a.md")).toBe("notes\\a.md")
    })
  })
})
