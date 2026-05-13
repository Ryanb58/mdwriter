import { describe, it, expect } from "vitest"
import { buildBreadcrumbTrail } from "../breadcrumbTrail"

describe("buildBreadcrumbTrail", () => {
  it("splits a nested doc path into vault, folders, and filename", () => {
    const t = buildBreadcrumbTrail("/Users/me/vault", "/Users/me/vault/notes/2026/may.md")
    expect(t.vaultName).toBe("vault")
    expect(t.folders).toEqual([
      { name: "notes", path: "/Users/me/vault/notes" },
      { name: "2026", path: "/Users/me/vault/notes/2026" },
    ])
    expect(t.fileName).toBe("may.md")
  })

  it("returns no folders when the doc sits at the vault root", () => {
    const t = buildBreadcrumbTrail("/vault", "/vault/readme.md")
    expect(t.vaultName).toBe("vault")
    expect(t.folders).toEqual([])
    expect(t.fileName).toBe("readme.md")
  })

  it("tolerates a trailing separator on the vault path", () => {
    const t = buildBreadcrumbTrail("/vault/", "/vault/notes/file.md")
    expect(t.folders).toEqual([{ name: "notes", path: "/vault/notes" }])
    expect(t.fileName).toBe("file.md")
  })

  it("builds cumulative paths with Windows-style separators", () => {
    const t = buildBreadcrumbTrail("C:\\Users\\me\\vault", "C:\\Users\\me\\vault\\a\\b\\c.md")
    expect(t.vaultName).toBe("vault")
    expect(t.folders).toEqual([
      { name: "a", path: "C:\\Users\\me\\vault\\a" },
      { name: "b", path: "C:\\Users\\me\\vault\\a\\b" },
    ])
    expect(t.fileName).toBe("c.md")
  })

  it("returns no clickable folders when the doc is outside the vault", () => {
    const t = buildBreadcrumbTrail("/vault", "/elsewhere/note.md")
    expect(t.folders).toEqual([])
    expect(t.fileName).toBe("note.md")
  })

  it("does not treat a sibling vault with a prefix-matching name as inside", () => {
    // /vault2/... must not look like it lives under /vault.
    const t = buildBreadcrumbTrail("/vault", "/vault2/notes/file.md")
    expect(t.folders).toEqual([])
    expect(t.fileName).toBe("file.md")
  })

  it("does not treat the root itself as a doc inside the vault", () => {
    const t = buildBreadcrumbTrail("/vault", "/vault")
    expect(t.folders).toEqual([])
  })

  it("handles a null root path gracefully", () => {
    const t = buildBreadcrumbTrail(null, "/wherever/note.md")
    expect(t.vaultName).toBe("")
    expect(t.folders).toEqual([])
    expect(t.fileName).toBe("note.md")
  })
})
