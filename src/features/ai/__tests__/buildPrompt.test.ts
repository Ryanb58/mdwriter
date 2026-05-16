import { describe, expect, it } from "vitest"
import { buildPrompt, extractWikilinks } from "../buildPrompt"

describe("extractWikilinks", () => {
  it("returns empty for plain text", () => {
    expect(extractWikilinks("hello world")).toEqual([])
  })

  it("captures a single link", () => {
    expect(extractWikilinks("look at [[notes]] please")).toEqual(["notes"])
  })

  it("captures multiple links and dedupes", () => {
    expect(extractWikilinks("[[a]] and [[b]] and [[a]]")).toEqual(["a", "b"])
  })

  it("ignores single brackets", () => {
    expect(extractWikilinks("[a] [b]")).toEqual([])
  })

  it("trims whitespace inside the link", () => {
    expect(extractWikilinks("[[  spaced  ]]")).toEqual(["spaced"])
  })

  it("does not match across newlines", () => {
    expect(extractWikilinks("[[start\nend]]")).toEqual([])
  })
})

describe("buildPrompt", () => {
  it("returns the raw text when no context applies", () => {
    expect(buildPrompt({ currentNote: null, userText: "hi" })).toBe("hi")
  })

  it("prepends the current note", () => {
    const out = buildPrompt({ currentNote: "today.md", userText: "summarize this" })
    expect(out).toContain("currently viewing: today.md")
    expect(out).toContain("summarize this")
    expect(out.indexOf("currently viewing")).toBeLessThan(out.indexOf("summarize"))
  })

  it("explains wikilinks in the prompt", () => {
    const out = buildPrompt({ currentNote: null, userText: "compare [[a]] and [[b]]" })
    expect(out).toContain("`a.md`")
    expect(out).toContain("`b.md`")
    expect(out).toContain("vault root")
  })

  it("includes both blocks when present", () => {
    const out = buildPrompt({ currentNote: "now.md", userText: "merge with [[other]]" })
    expect(out).toContain("currently viewing: now.md")
    expect(out).toContain("`other.md`")
  })

  it("attaches a selection block when provided", () => {
    const out = buildPrompt({
      currentNote: "now.md",
      userText: "rewrite that",
      selection: { text: "hello world", sourceNote: "now.md" },
    })
    expect(out).toContain("<selection>")
    expect(out).toContain("hello world")
    expect(out).toContain("</selection>")
    expect(out).toContain("(from now.md)")
  })

  it("omits the selection block when text is empty", () => {
    const out = buildPrompt({
      currentNote: null,
      userText: "hi",
      selection: { text: "", sourceNote: null },
    })
    expect(out).toBe("hi")
  })
})
