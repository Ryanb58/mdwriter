import { describe, expect, it } from "vitest"
import type { Skill } from "../../../lib/ipc"
import { buildPrompt, extractSkillRefs, extractWikilinks } from "../buildPrompt"

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

  it("prepends chat instructions when provided", () => {
    const out = buildPrompt({
      currentNote: null,
      userText: "answer please",
      systemPrompt: "Respond in haiku.",
    })
    expect(out).toContain("[chat instructions]")
    expect(out).toContain("Respond in haiku.")
    expect(out.indexOf("instructions")).toBeLessThan(out.indexOf("answer please"))
  })

  it("ignores whitespace-only instructions", () => {
    const out = buildPrompt({
      currentNote: null,
      userText: "hi",
      systemPrompt: "   ",
    })
    expect(out).toBe("hi")
  })
})

describe("extractSkillRefs", () => {
  it("returns empty when no skill refs are present", () => {
    expect(extractSkillRefs("hello [[note]] world")).toEqual([])
  })

  it("captures a single skill ref", () => {
    expect(extractSkillRefs("please [[skill:critique]] this")).toEqual([
      "critique",
    ])
  })

  it("captures multiple skill refs and dedupes", () => {
    expect(extractSkillRefs("[[skill:a]] [[skill:b]] [[skill:a]]")).toEqual([
      "a",
      "b",
    ])
  })

  it("does not match plain note wikilinks", () => {
    expect(extractSkillRefs("[[plain-note]]")).toEqual([])
  })
})

describe("extractWikilinks (skill exclusion)", () => {
  it("ignores skill: refs so they don't show up as notes", () => {
    expect(extractWikilinks("[[note]] [[skill:critique]] [[note]]")).toEqual([
      "note",
    ])
  })
})

describe("buildPrompt with skills", () => {
  const skills: Skill[] = [
    {
      name: "critique",
      description: "Critique writing",
      source: "vault-claude",
      absPath: "/vault/.claude/skills/critique/SKILL.md",
      vaultRelPath: ".claude/skills/critique/SKILL.md",
    },
    {
      name: "summarize",
      description: "Summarize content",
      source: "user-claude",
      absPath: "/home/u/.claude/skills/summarize/SKILL.md",
      vaultRelPath: null,
    },
  ]

  it("renders a skill block with vault-relative paths when available", () => {
    const out = buildPrompt({
      currentNote: null,
      userText: "please [[skill:critique]] this",
      availableSkills: skills,
    })
    expect(out).toContain("invoked these skills")
    expect(out).toContain("critique → .claude/skills/critique/SKILL.md")
  })

  it("uses the absolute path for user-level skills", () => {
    const out = buildPrompt({
      currentNote: null,
      userText: "[[skill:summarize]]",
      availableSkills: skills,
    })
    expect(out).toContain(
      "summarize → /home/u/.claude/skills/summarize/SKILL.md",
    )
  })

  it("marks unresolved skill refs explicitly", () => {
    const out = buildPrompt({
      currentNote: null,
      userText: "[[skill:nonexistent]]",
      availableSkills: skills,
    })
    expect(out).toContain("nonexistent → (unresolved")
  })

  it("renders skills alongside notes and selection", () => {
    const out = buildPrompt({
      currentNote: "today.md",
      userText: "rewrite [[notes]] using [[skill:critique]]",
      selection: { text: "draft text", sourceNote: "today.md" },
      availableSkills: skills,
    })
    expect(out).toContain("currently viewing: today.md")
    expect(out).toContain("`notes.md`")
    expect(out).toContain("critique → .claude/skills/critique/SKILL.md")
    expect(out).toContain("<selection>")
    expect(out).toContain("draft text")
  })
})
