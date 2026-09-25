import { describe, expect, it } from "vitest"
import { analyzeDocument, fingerprintDocument } from "../documentAnalysis"

describe("analyzeDocument", () => {
  it("detects compatibility risks in the Markdown body without scanning valid frontmatter", () => {
    const text = [
      "---",
      "template: <Panel>{value}</Panel>",
      "---",
      "",
      "A preserved note[^source].",
    ].join("\n")

    const analysis = analyzeDocument("/vault/note.md", text)

    expect(analysis.parseError).toBeNull()
    expect(analysis.markdownRisks.map((risk) => risk.code)).toEqual(["footnote"])
  })

  it("adds a named frontmatter error only when structural parsing fails", () => {
    const text = '---\ntitle: "bad\\q"\n---\n\nSafe body'

    const analysis = analyzeDocument("/vault/note.md", text)

    expect(analysis.parseError).toMatch(/escape/i)
    expect(analysis.markdownRisks).toContainEqual({
      code: "frontmatter-error",
      label: "frontmatter that could not be parsed",
    })
  })

  it("does not treat preserved but unmodeled complex YAML as a parse error", () => {
    const text = [
      "---",
      "defaults: &defaults",
      "  nested:",
      "    enabled: true",
      "merged:",
      "  <<: *defaults",
      "description: |",
      "  Multiple lines stay byte-for-byte.",
      "---",
      "",
      "Safe body",
    ].join("\n")

    const analysis = analyzeDocument("/vault/note.md", text)

    expect(analysis.parseError).toBeNull()
    expect(analysis.markdownRisks).toEqual([])
  })

  it("fingerprints the complete text deterministically", () => {
    const first = "---\ntitle: One\n---\n\nBody"
    const frontmatterChanged = "---\ntitle: Two\n---\n\nBody"
    const bodyChanged = "---\ntitle: One\n---\n\nDifferent body"

    expect(fingerprintDocument(first)).toBe(fingerprintDocument(first))
    expect(fingerprintDocument(frontmatterChanged)).not.toBe(fingerprintDocument(first))
    expect(fingerprintDocument(bodyChanged)).not.toBe(fingerprintDocument(first))
    expect(analyzeDocument("/a.md", first).contentFingerprint).toBe(
      analyzeDocument("/b.md", first).contentFingerprint,
    )
  })

  it("keeps CRLF frontmatter envelopes out of Block mode without scanning YAML as prose", () => {
    const text = [
      "---",
      "template: <Panel>{value}</Panel>",
      "---",
      "",
      "# Safe body",
    ].join("\r\n")

    const analysis = analyzeDocument("/vault/windows.md", text)

    expect(analysis.parseError).toBeNull()
    expect(analysis.markdownRisks).toEqual([{
      code: "ambiguous-frontmatter",
      label: "frontmatter that needs raw editing",
    }])
  })

  it("guards a BOM-prefixed frontmatter envelope without scanning YAML as prose", () => {
    const text = "\uFEFF---\ntemplate: <Panel>{value}</Panel>\n---\n\n# Safe body"

    const analysis = analyzeDocument("/vault/bom.md", text)

    expect(analysis.parseError).toBeNull()
    expect(analysis.markdownRisks).toEqual([{
      code: "ambiguous-frontmatter",
      label: "frontmatter that needs raw editing",
    }])
  })

  it("guards a CR-only frontmatter envelope and still scans its body", () => {
    const text = "---\rtemplate: <Panel>{value}</Panel>\r---\r\rA claim[^source]."

    const analysis = analyzeDocument("/vault/classic-mac.md", text)

    expect(analysis.parseError).toBeNull()
    expect(analysis.markdownRisks.map((risk) => risk.code)).toEqual([
      "footnote",
      "ambiguous-frontmatter",
    ])
  })

  it("does not treat an ordinary BOM-prefixed note as frontmatter", () => {
    const analysis = analyzeDocument("/vault/plain.md", "\uFEFF# Ordinary note")

    expect(analysis.markdownRisks).toEqual([])
  })

  it("guards a mixed-ending frontmatter envelope that the LF parser cannot model", () => {
    const text = "---\r\ntemplate: <Panel>{value}</Panel>\n---\n\n# Safe body"

    const analysis = analyzeDocument("/vault/mixed.md", text)

    expect(analysis.markdownRisks).toEqual([{
      code: "ambiguous-frontmatter",
      label: "frontmatter that needs raw editing",
    }])
  })

  it("deduplicates the envelope risk when the Markdown body is also ambiguous", () => {
    const text = "---\r\ntitle: Note\r\n---\r\n\r\n---\r\nunclosed body fence"

    const analysis = analyzeDocument("/vault/double.md", text)

    expect(analysis.markdownRisks.filter((risk) => risk.code === "ambiguous-frontmatter"))
      .toHaveLength(1)
  })

  it.each(["\n", "\r\n", "\r"])("uses full-file coordinates with %j frontmatter", (newline) => {
    const text = ["---", "template: <Panel />", "---", "", "😀 A claim[^source]."].join(newline)
    const analysis = analyzeDocument("/vault/note.md", text)
    const issue = analysis.markdownIssues.find((item) => item.code === "footnote")!
    expect(issue).toMatchObject({
      line: 5, column: 10, endLine: 5, snippet: "😀 A claim[^source].",
    })
    expect(text.slice(issue.from, issue.to)).toBe("[^source]")
    expect(analysis.markdownIssues.some((item) => item.code === "mdx")).toBe(false)
  })

  it("locates both a BOM/mixed-ending envelope and an ambiguous body", () => {
    const text = "\uFEFF---\r\ntitle: Note\n---\r\n\r\n---\nunclosed"
    const analysis = analyzeDocument("/vault/note.md", text)
    expect(analysis.markdownRisks).toHaveLength(1)
    expect(analysis.markdownIssues).toMatchObject([
      { code: "ambiguous-frontmatter", from: 1, to: 4, line: 1, column: 2 },
      { code: "ambiguous-frontmatter", line: 5, column: 1 },
    ])
  })

  it("locates invalid YAML in its envelope, not in the body", () => {
    const text = '---\ntitle: "bad\\q"\n---\n\nA note[^a]'
    const analysis = analyzeDocument("/vault/note.md", text)
    expect(analysis.markdownIssues).toMatchObject([
      { code: "frontmatter-error", from: 0, line: 1 },
      { code: "footnote", line: 5, column: 7, snippet: "A note[^a]" },
    ])
    expect(analysis.parseError).toMatch(/escape/i)
  })

  it("includes source context and accurate line spans for multiline constructs", () => {
    const text = 'Intro\n\n[Docs](/docs\n  "Reference")\n\n> First\n>\n> Second'
    expect(analyzeDocument("/vault/note.md", text).markdownIssues).toMatchObject([
      { code: "link-title", line: 3, endLine: 4, column: 1, snippet: "[Docs](/docs…" },
      { code: "multi-paragraph-quote", line: 6, endLine: 8, column: 1, snippet: "> First…" },
    ])
  })

  it("bounds long snippets around the match instead of hiding it", () => {
    const text = "A".repeat(500) + "[^note]" + "B".repeat(500)
    const [issue] = analyzeDocument("/vault/note.md", text).markdownIssues
    expect(issue.column).toBe(501)
    expect(issue.snippet).toContain("[^note]")
    expect(issue.snippet.startsWith("…")).toBe(true)
    expect(issue.snippet.endsWith("…")).toBe(true)
    expect(issue.snippet.length).toBeLessThanOrEqual(162)
  })

  it.each(["\n", "\r\n", "\r"])("retains a %j line break at offset zero when narrowing its index", (newline) => {
    const text = `${newline}[^a]`
    expect(analyzeDocument("/vault/note.md", text).markdownIssues).toEqual([
      {
        code: "footnote", from: newline.length, to: text.length,
        line: 2, column: 1, endLine: 2, snippet: "[^a]",
      },
    ])
  })

  it("tracks Unicode columns across a dense long line and resets them on the next line", () => {
    const count = 2000
    const fragment = "😀[^a] "
    const text = fragment.repeat(count) + "\r\n😀[^b]"
    const issues = analyzeDocument("/vault/note.md", text).markdownIssues
    expect(issues).toHaveLength(count + 1)
    for (let index = 0; index < count; index += 1) {
      expect(issues[index]).toMatchObject({
        from: index * fragment.length + 2,
        to: index * fragment.length + 6,
        line: 1, column: index * 6 + 2, endLine: 1,
      })
      expect(issues[index].snippet).toContain("[^a]")
      expect(issues[index].snippet.length).toBeLessThanOrEqual(162)
    }
    expect(issues[count]).toMatchObject({ line: 2, column: 2, endLine: 2, snippet: "😀[^b]" })
  })

  it("does not double-count columns for overlapping issues with the same start", () => {
    const text = '```math title="equation"\nx^2\n```\n\n😀[^a]'
    expect(analyzeDocument("/vault/note.md", text).markdownIssues).toMatchObject([
      { code: "math", from: 0, line: 1, column: 1 },
      { code: "code-fence-metadata", from: 0, line: 1, column: 1 },
      { code: "footnote", line: 5, column: 2 },
    ])
  })
})
