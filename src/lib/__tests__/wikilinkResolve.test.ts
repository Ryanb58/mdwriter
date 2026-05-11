import { describe, it, expect } from "vitest"
import {
  parseWikilink,
  resolveLinkTarget,
  isInternalHref,
  stripMdExt,
} from "../wikilinkResolve"
import type { VaultNote } from "../vaultNotes"

const notes: VaultNote[] = [
  { name: "Three laws of motion", path: "/v/physics/Three laws of motion.md", rel: "physics/Three laws of motion.md" },
  { name: "Inertia", path: "/v/physics/Inertia.md", rel: "physics/Inertia.md" },
  { name: "Index", path: "/v/Index.md", rel: "Index.md" },
  { name: "Inertia", path: "/v/biographies/Inertia.md", rel: "biographies/Inertia.md" },
]

describe("parseWikilink", () => {
  it("returns target only when no pipe", () => {
    expect(parseWikilink("Three laws of motion")).toEqual({ target: "Three laws of motion", alias: null })
  })
  it("strips .md from target", () => {
    expect(parseWikilink("Inertia.md")).toEqual({ target: "Inertia", alias: null })
  })
  it("splits alias on first pipe", () => {
    expect(parseWikilink("Three laws of motion|3 laws")).toEqual({
      target: "Three laws of motion",
      alias: "3 laws",
    })
  })
  it("trims whitespace", () => {
    expect(parseWikilink("  Inertia  |  pretty  ")).toEqual({
      target: "Inertia",
      alias: "pretty",
    })
  })
})

describe("resolveLinkTarget", () => {
  it("matches by filename stem", () => {
    const n = resolveLinkTarget("Three laws of motion", notes)
    expect(n?.path).toBe("/v/physics/Three laws of motion.md")
  })
  it("matches with .md extension", () => {
    const n = resolveLinkTarget("Three laws of motion.md", notes)
    expect(n?.path).toBe("/v/physics/Three laws of motion.md")
  })
  it("is case-insensitive", () => {
    const n = resolveLinkTarget("three laws of motion", notes)
    expect(n?.path).toBe("/v/physics/Three laws of motion.md")
  })
  it("resolves URL-encoded markdown-link targets", () => {
    const n = resolveLinkTarget("Three%20laws%20of%20motion", notes)
    expect(n?.path).toBe("/v/physics/Three laws of motion.md")
  })
  it("matches by rel path", () => {
    const n = resolveLinkTarget("biographies/Inertia", notes)
    expect(n?.path).toBe("/v/biographies/Inertia.md")
  })
  it("matches by path suffix when ambiguous", () => {
    const n = resolveLinkTarget("biographies/Inertia.md", notes)
    expect(n?.path).toBe("/v/biographies/Inertia.md")
  })
  it("returns first by tree order when stem is ambiguous", () => {
    // Both physics/Inertia and biographies/Inertia exist; bare "Inertia"
    // should match the first in input order (physics/Inertia).
    const n = resolveLinkTarget("Inertia", notes)
    expect(n?.path).toBe("/v/physics/Inertia.md")
  })
  it("returns null when no match", () => {
    expect(resolveLinkTarget("Nonexistent note", notes)).toBeNull()
  })
  it("strips a leading slash before matching", () => {
    const n = resolveLinkTarget("/Index.md", notes)
    expect(n?.path).toBe("/v/Index.md")
  })
  it("strips a leading ./ before matching", () => {
    const n = resolveLinkTarget("./biographies/Inertia", notes)
    expect(n?.path).toBe("/v/biographies/Inertia.md")
  })
  it("collapses repeated ./ prefixes", () => {
    const n = resolveLinkTarget(".//./Index", notes)
    expect(n?.path).toBe("/v/Index.md")
  })
})

describe("isInternalHref", () => {
  it("treats relative paths as internal", () => {
    expect(isInternalHref("Three%20laws%20of%20motion.md")).toBe(true)
    expect(isInternalHref("./notes/foo")).toBe(true)
  })
  it("rejects anchors", () => {
    expect(isInternalHref("#section")).toBe(false)
  })
  it("rejects http(s) and other schemes", () => {
    expect(isInternalHref("https://example.com")).toBe(false)
    expect(isInternalHref("mailto:a@b.com")).toBe(false)
    expect(isInternalHref("file:///foo")).toBe(false)
  })
})

describe("stripMdExt", () => {
  it("removes .md", () => {
    expect(stripMdExt("foo.md")).toBe("foo")
  })
  it("removes .markdown", () => {
    expect(stripMdExt("foo.markdown")).toBe("foo")
  })
  it("leaves other extensions alone", () => {
    expect(stripMdExt("foo.txt")).toBe("foo.txt")
  })
})
