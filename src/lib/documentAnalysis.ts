import { parseDoc } from "./doc"
import {
  detectMarkdownRisks,
  type MarkdownRisk,
  type MarkdownRiskCode,
} from "./markdownRisks"

export type DocumentRiskCode = MarkdownRiskCode | "frontmatter-error"

export type DocumentRisk =
  | MarkdownRisk
  | { code: "frontmatter-error"; label: string }

export type DocumentAnalysis = {
  parseError: string | null
  markdownRisks: DocumentRisk[]
  contentFingerprint: string
}

/**
 * A small deterministic identity for the complete in-memory document. It is
 * deliberately not cryptographic: the value only scopes a user's explicit
 * block-mode override to the exact bytes they reviewed.
 */
export function fingerprintDocument(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`
}

/** Analyze a full Markdown file without changing its bytes. */
export function analyzeDocument(path: string, text: string): DocumentAnalysis {
  void path
  const parsed = parseDoc(text)
  const needsEnvelopeRisk = text.startsWith("---\r\n") && !parsed.frontmatterRange
  const protectedBody = needsEnvelopeRisk ? crlfFrontmatterBody(text) : null
  const markdownRisks: DocumentRisk[] = detectMarkdownRisks(protectedBody ?? parsed.body)

  // The current byte-preserving frontmatter helpers intentionally recognize
  // LF envelopes only. Treat a valid-looking CRLF envelope as raw-only rather
  // than feeding its YAML lines through BlockNote as document prose.
  if (
    needsEnvelopeRisk &&
    !markdownRisks.some((risk) => risk.code === "ambiguous-frontmatter")
  ) {
    markdownRisks.push({
      code: "ambiguous-frontmatter",
      label: "frontmatter that needs raw editing",
    })
  }

  if (parsed.parseError) {
    markdownRisks.push({
      code: "frontmatter-error",
      label: "frontmatter that could not be parsed",
    })
  }

  return {
    parseError: parsed.parseError,
    markdownRisks,
    contentFingerprint: fingerprintDocument(text),
  }
}

function crlfFrontmatterBody(text: string): string | null {
  const match = text.match(/^---\r\n[\s\S]*?\r?\n---(?:\r?\n)?/)
  if (!match) return null
  let bodyStart = match[0].length
  if (text.startsWith("\r\n", bodyStart)) bodyStart += 2
  else if (text.startsWith("\n", bodyStart)) bodyStart += 1
  return text.slice(bodyStart)
}
