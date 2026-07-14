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
})
