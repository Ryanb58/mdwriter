import { describe, expect, it } from "vitest"
import { scoreSkillMatch } from "../scoreSkill"

function score(name: string, description: string, search: string) {
  return scoreSkillMatch(`${name}__vault-claude`, search, [description, "vault-claude"])
}

describe("scoreSkillMatch", () => {
  it("returns 1 for an empty query so every row is included", () => {
    expect(score("anything", "anything", "")).toBe(1)
    expect(score("anything", "anything", "   ")).toBe(1)
  })

  it("matches a contiguous substring in the name", () => {
    expect(score("competitor-profiling", "Profile competitors", "compe")).toBeGreaterThan(0)
  })

  it("does not match fuzzy character pickup across non-contiguous letters", () => {
    // 'extract' description has c-o-m-p-o-n-e (no contiguous 'compe').
    expect(
      score("extract", "Extract and consolidate reusable components", "compe"),
    ).toBe(0)
  })

  it("scores prefix matches on name higher than mid-word matches", () => {
    const prefix = score("compete", "X", "comp")
    const mid = score("incompetent", "X", "comp")
    expect(prefix).toBeGreaterThan(mid)
    expect(prefix).toBeGreaterThan(0)
    expect(mid).toBeGreaterThan(0)
  })

  it("scores name matches higher than description-only matches", () => {
    const inName = score("critique", "Some description", "crit")
    const inDesc = score("polish", "Critique the work", "crit")
    expect(inName).toBeGreaterThan(inDesc)
    expect(inDesc).toBeGreaterThan(0)
  })

  it("rewards word-boundary matches over mid-word matches", () => {
    const wordStart = score("foo-bar-quux", "X", "bar")
    const midWord = score("foobarquux", "X", "bar")
    expect(wordStart).toBeGreaterThan(midWord)
  })

  it("requires every whitespace-separated token to appear", () => {
    // 'compe' matches 'competitor', 'profil' matches 'profiling'.
    expect(score("competitor profiling", "X", "compe profil")).toBeGreaterThan(0)
    // 'adapter' has no 'profil' substring → reject the whole row.
    expect(score("competitor adapter", "X", "compe profil")).toBe(0)
  })

  it("is case-insensitive on both sides", () => {
    expect(score("Critique", "DESCRIPTION", "CRIT")).toBeGreaterThan(0)
    expect(score("Critique", "DESCRIPTION", "description")).toBeGreaterThan(0)
  })

  it("rejects a token that matches nothing", () => {
    expect(score("alpha", "beta gamma", "zzz")).toBe(0)
  })

  it("rejects single-character noise that doesn't appear", () => {
    expect(score("polish", "Polish the design", "q")).toBe(0)
  })

  it("returns a higher score for exact-name match over partial", () => {
    const exact = score("polish", "Polish the design", "polish")
    const partial = score("polishing", "Polish the design", "polish")
    expect(exact).toBeGreaterThanOrEqual(partial)
  })

  it("treats hyphenated names as having word-boundary breaks at hyphens", () => {
    const atBoundary = score("foo-critique", "X", "critique")
    const midWord = score("foocritique", "X", "critique")
    expect(atBoundary).toBeGreaterThan(midWord)
  })
})
