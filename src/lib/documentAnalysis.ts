import { parseDoc } from "./doc"
import {
  inspectMarkdownRisks,
  summarizeMarkdownRisks,
  type MarkdownRisk,
  type MarkdownRiskCode,
} from "./markdownRisks"

export type DocumentRiskCode = MarkdownRiskCode | "frontmatter-error"

export type DocumentRisk =
  | MarkdownRisk
  | { code: "frontmatter-error"; label: string }

export type DocumentIssue = {
  code: DocumentRiskCode
  /** UTF-16 offsets in the complete, original file; end is exclusive. */
  from: number
  to: number
  /** One-based source coordinates (columns count Unicode code points). */
  line: number
  column: number
  endLine: number
  /** Bounded, plain-text source context, never rendered as Markdown/HTML. */
  snippet: string
}

export type DocumentAnalysis = {
  parseError: string | null
  markdownRisks: DocumentRisk[]
  markdownIssues: DocumentIssue[]
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
  const body = protectedBody ?? parsed.body
  const bodyStart = text.length - body.length
  const matches = inspectMarkdownRisks(body)
  const markdownRisks: DocumentRisk[] = summarizeMarkdownRisks(matches)
  const ranges: Array<Pick<DocumentIssue, "code" | "from" | "to">> = matches.map(
    (match) => ({ ...match, from: match.from + bodyStart, to: match.to + bodyStart }),
  )

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
  if (needsEnvelopeRisk) {
    // The envelope itself is a location even when its body has the same risk.
    const from = text.charCodeAt(0) === 0xfeff ? 1 : 0
    ranges.push({ code: "ambiguous-frontmatter", from, to: from + 3 })
  }

  if (parsed.parseError) {
    markdownRisks.push({
      code: "frontmatter-error",
      label: "frontmatter that could not be parsed",
    })
    ranges.push({
      code: "frontmatter-error",
      from: 0,
      to: (parsed.frontmatterRange?.end ?? text.length),
    })
  }

  return {
    parseError: parsed.parseError,
    markdownRisks,
    markdownIssues: locateIssues(text, ranges),
    contentFingerprint: fingerprintDocument(text),
  }
}

function locateIssues(
  text: string,
  ranges: Array<Pick<DocumentIssue, "code" | "from" | "to">>,
): DocumentIssue[] {
  const lineStarts = [0]
  const lineEnds: number[] = []
  for (const match of text.matchAll(/\r\n?|\n/g)) {
    const index = match.index
    if (index === undefined) continue
    lineEnds.push(index)
    lineStarts.push(index + match[0].length)
  }
  lineEnds.push(text.length)
  const lineAt = (offset: number) => {
    let low = 0
    let high = lineStarts.length
    while (low + 1 < high) {
      const mid = (low + high) >>> 1
      if (lineStarts[mid] <= offset) low = mid
      else high = mid
    }
    return low
  }
  let previousLine = -1
  let columnCursor = 0
  let column = 1
  return ranges.sort((a, b) => a.from - b.from || a.to - b.to).map((range) => {
    const lineIndex = lineAt(range.from)
    // Ranges are ordered by start, including overlapping ranges. Count each
    // line prefix once rather than rescanning it for every issue on the line.
    if (lineIndex !== previousLine) {
      columnCursor = lineStarts[lineIndex]
      column = 1
      previousLine = lineIndex
    }
    for (const character of text.slice(columnCursor, range.from)) {
      columnCursor += character.length
      column += 1
    }
    // Include nearby prose, but center long-line previews on the risky token.
    const previewStart = Math.max(lineStarts[lineIndex], range.from - 32)
    const contentEnd = lineEnds[lineIndex]
    const previewEnd = Math.min(contentEnd, previewStart + 160)
    const endLine = lineAt(Math.max(range.from, range.to - 1)) + 1
    const truncated = previewEnd < contentEnd || endLine > lineIndex + 1
    return {
      ...range,
      line: lineIndex + 1,
      column,
      endLine,
      snippet: (previewStart > lineStarts[lineIndex] ? "…" : "") +
        text.slice(previewStart, previewEnd) +
        (truncated ? "…" : ""),
    }
  })
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
