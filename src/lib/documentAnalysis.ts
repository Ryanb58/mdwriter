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
  const protectedBody = parsed.frontmatterRange
    ? null
    : unparsedFrontmatterBody(text)
  const needsEnvelopeRisk = protectedBody !== null
  const markdownRisks: DocumentRisk[] = detectMarkdownRisks(protectedBody ?? parsed.body)

  // The current byte-preserving frontmatter helpers intentionally recognize
  // LF envelopes without a BOM only. Treat any other valid-looking envelope
  // as raw-only rather than feeding its YAML lines through BlockNote as prose.
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

/**
 * Return the body of a frontmatter-looking envelope that `parseDoc` could
 * not model. `""` means the opener was present but no closer was found, so
 * everything after it remains ambiguous rather than being scanned as prose.
 */
function unparsedFrontmatterBody(text: string): string | null {
  const openerStart = text.charCodeAt(0) === 0xfeff ? 1 : 0
  if (text.slice(openerStart, openerStart + 3) !== "---") return null

  const openerEnd = openerStart + 3
  const openerBreak = lineBreakLengthAt(text, openerEnd)
  if (openerBreak === 0) return null

  let cursor = openerEnd + openerBreak
  while (cursor <= text.length) {
    let lineEnd = cursor
    while (lineEnd < text.length && text[lineEnd] !== "\n" && text[lineEnd] !== "\r") {
      lineEnd += 1
    }

    if (text.slice(cursor, lineEnd) === "---") {
      let bodyStart = lineEnd + lineBreakLengthAt(text, lineEnd)
      bodyStart += lineBreakLengthAt(text, bodyStart)
      return text.slice(bodyStart)
    }

    if (lineEnd >= text.length) break
    cursor = lineEnd + lineBreakLengthAt(text, lineEnd)
  }

  return ""
}

function lineBreakLengthAt(text: string, index: number): number {
  if (text.startsWith("\r\n", index)) return 2
  return text[index] === "\r" || text[index] === "\n" ? 1 : 0
}
