import { describe, expect, it } from "vitest"
import { preprocessLinks } from "../MarkdownView"

describe("preprocessLinks", () => {
  it("turns wikilinks into mdwriter: links", () => {
    expect(preprocessLinks("see [[Foo]] and [[Bar Baz]]")).toBe(
      "see [Foo](mdwriter:Foo) and [Bar Baz](mdwriter:Bar%20Baz)",
    )
  })

  it("links bare vault-relative markdown paths", () => {
    expect(preprocessLinks("open notes/foo.md please")).toBe(
      "open [notes/foo.md](mdwriter:notes%2Ffoo.md) please",
    )
  })

  it("leaves paths that are already markdown links alone", () => {
    const src = "see [notes/foo.md](other) here"
    expect(preprocessLinks(src)).toBe(src)
  })

  it("does not touch wikilinks inside fenced code blocks", () => {
    const src = "before\n```\n[[Skip]]\n```\nafter [[Take]]"
    const out = preprocessLinks(src)
    expect(out).toContain("[[Skip]]")
    expect(out).toContain("[Take](mdwriter:Take)")
  })

  it("does not touch wikilinks inside inline code", () => {
    const src = "use `[[Foo]]` to link but [[Bar]] is real"
    const out = preprocessLinks(src)
    expect(out).toContain("`[[Foo]]`")
    expect(out).toContain("[Bar](mdwriter:Bar)")
  })

  it("ignores empty wikilinks", () => {
    expect(preprocessLinks("[[]]")).toBe("[[]]")
  })

  it("leaves whitespace-only wikilinks untouched", () => {
    expect(preprocessLinks("text [[   ]] more")).toBe("text [[   ]] more")
  })

  it("links paths followed by trailing punctuation", () => {
    expect(preprocessLinks("see sub/path.md, it's fine")).toContain(
      "[sub/path.md](mdwriter:sub%2Fpath.md)",
    )
  })

  it("skips path-like tokens immediately after a `(` to avoid mangling `](url.md)`", () => {
    const src = "see [text](other/path.md) for details"
    expect(preprocessLinks(src)).toBe(src)
  })

  it("leaves URLs that contain .md alone", () => {
    const src = "see https://example.com/foo.md for context"
    // Bare-path regex requires a slash-containing segment that doesn't
    // include "://" — URLs naturally get skipped.
    expect(preprocessLinks(src)).toBe(src)
  })
})
