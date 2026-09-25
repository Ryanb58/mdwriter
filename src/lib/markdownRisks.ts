export type MarkdownRiskCode =
  | "html-comment"
  | "footnote"
  | "reference-definition"
  | "link-title"
  | "mdx"
  | "raw-html"
  | "inline-html"
  | "math"
  | "directive"
  | "table-alignment"
  | "code-fence-metadata"
  | "multi-paragraph-quote"
  | "ambiguous-frontmatter"

export type MarkdownRisk = { code: MarkdownRiskCode; label: string }

/** UTF-16 source offsets, [from, to), in the original (not normalized) body. */
export type MarkdownRiskMatch = { code: MarkdownRiskCode; from: number; to: number }
type ReportRisk = (code: MarkdownRiskCode, from: number, to: number) => void

const RISK_LABELS: Record<MarkdownRiskCode, string> = {
  "html-comment": "HTML comments",
  footnote: "footnotes",
  "reference-definition": "reference-style links",
  "link-title": "link or image titles",
  mdx: "MDX or JSX",
  "raw-html": "raw HTML blocks",
  "inline-html": "inline HTML",
  math: "display math",
  directive: "directives",
  "table-alignment": "table alignment",
  "code-fence-metadata": "code fence metadata",
  "multi-paragraph-quote": "multi-paragraph blockquotes",
  "ambiguous-frontmatter": "frontmatter that needs raw editing",
}

const RISK_ORDER = Object.keys(RISK_LABELS) as MarkdownRiskCode[]

type Line = { text: string; start: number; end: number }

const RAW_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "script",
  "style",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "pre",
  "textarea",
  "ul",
])

const VOID_RAW_BLOCK_TAGS = new Set([
  "area",
  "base",
  "basefont",
  "br",
  "col",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
])

/**
 * Detect source constructs that BlockNote 0.50 cannot reliably preserve.
 * This is intentionally a conservative syntax scanner rather than a second
 * Markdown parser. Protected code regions are blanked without removing
 * newlines so the remaining line-oriented checks keep their shape.
 */
export function detectMarkdownRisks(body: string): MarkdownRisk[] {
  return summarizeMarkdownRisks(inspectMarkdownRisks(body))
}

/** Keep the existing deduplicated labels/order contract separate from occurrences. */
export function summarizeMarkdownRisks(matches: MarkdownRiskMatch[]): MarkdownRisk[] {
  const found = new Set(matches.map((match) => match.code))
  return RISK_ORDER.filter((code) => found.has(code)).map((code) => ({
    code,
    label: RISK_LABELS[code],
  }))
}

export function inspectMarkdownRisks(body: string): MarkdownRiskMatch[] {
  // Preserve a map back to original offsets across CRLF/CR normalization.
  // split("") below is deliberate: regex indices and editor ranges use UTF-16,
  // not code-point indices (which diverge after emoji/non-BMP characters).
  const offsets: number[] = []
  let source = ""
  for (let index = 0; index < body.length; index += 1) {
    offsets.push(index)
    source += body[index] === "\r" ? "\n" : body[index]
    if (body[index] === "\r" && body[index + 1] === "\n") index += 1
  }
  offsets.push(body.length)
  const matches: MarkdownRiskMatch[] = []
  const report: ReportRisk = (code, from, to) => {
    matches.push({ code, from: offsets[from], to: offsets[to] })
  }
  const chars = source.split("")

  maskFencedCode(source, chars, report)
  maskIndentedCode(source, chars)
  maskEscapes(chars)
  maskInlineCode(chars)
  const visible = chars.join("")
  detectAmbiguousFrontmatter(visible, report)

  // Raw HTML is masked only for the two HTML/MDX classifiers. Other named
  // constructs still deserve their own labels when they occur inside a raw
  // block, and all of them already operate on code/escape-protected text.
  const outsideRawHtmlChars = visible.split("")
  maskRawHtmlBlocks(outsideRawHtmlChars, report)
  const outsideRawHtml = outsideRawHtmlChars.join("")

  reportMatches(visible, /<!--/g, "html-comment", report)
  reportMatches(visible, /\[\^[^\]\n]+\]/g, "footnote", report)
  reportMatches(visible, /^ {0,3}\[(?!\^)[^\]\n]+\]:\s*\S+/gm, "reference-definition", report)
  detectInlineLinkTitles(visible, report)
  detectMdx(outsideRawHtml, report)
  reportMatches(outsideRawHtml, /<\/?([a-z][\w-]*)(?:\s[^<>\n]*?)?\s*\/?>/g, "inline-html", report)
  reportMatches(visible, /(?<!\$)\$\$(?!\$)/g, "math", report)
  reportMatches(visible, /^ {0,3}\\\[(?:\s.*)?$/gm, "math", report)
  reportMatches(visible, /^ {0,3}:{3,}(?:[^:]|$)/gm, "directive", report)
  detectAlignedTableDelimiters(visible, report)
  detectMultiParagraphQuotes(visible, report)

  return matches.sort((a, b) => a.from - b.from || a.to - b.to)
}

function reportMatches(text: string, pattern: RegExp, code: MarkdownRiskCode, report: ReportRisk) {
  for (const match of text.matchAll(pattern)) {
    report(code, match.index, match.index + match[0].length)
  }
}

function linesOf(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text[index] !== "\n") continue
    lines.push({ text: text.slice(start, index), start, end: index })
    start = index + 1
  }
  return lines
}

function maskRange(chars: string[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (chars[index] !== "\n") chars[index] = " "
  }
}

function detectAmbiguousFrontmatter(
  source: string,
  report: ReportRisk,
): void {
  const lines = source.split("\n")
  if (lines[0] !== "---") return
  if (!lines.slice(1).some((line) => line === "---")) {
    report("ambiguous-frontmatter", 0, 3)
  }
}

function maskFencedCode(
  source: string,
  chars: string[],
  report: ReportRisk,
): void {
  const lines = linesOf(source)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const match = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(
      withoutBlockquotePrefix(line.text),
    )
    if (!match) continue

    const marker = match[1]
    const info = match[2].trim()
    // A backtick fence info string cannot itself contain a backtick. Treat
    // such a line as an inline code span so the inline masker can handle it.
    if (marker[0] === "`" && info.includes("`")) continue

    const tokens = info ? info.split(/\s+/) : []
    const language = tokens[0]?.toLowerCase() ?? ""
    if (["math", "latex", "katex"].includes(language)) report("math", line.start, line.end)
    if (
      tokens.length > 1 ||
      (tokens.length === 1 && (/^[{[]/.test(tokens[0]) || tokens[0].includes("=")))
    ) {
      report("code-fence-metadata", line.start, line.end)
    }

    let lastLine = lines.length - 1
    for (let candidate = lineIndex + 1; candidate < lines.length; candidate += 1) {
      const closing = /^ {0,3}(`+|~+)\s*$/.exec(
        withoutBlockquotePrefix(lines[candidate].text),
      )
      if (
        closing &&
        closing[1][0] === marker[0] &&
        closing[1].length >= marker.length
      ) {
        lastLine = candidate
        break
      }
    }

    const end = lastLine + 1 < lines.length ? lines[lastLine + 1].start : source.length
    maskRange(chars, line.start, end)
    lineIndex = lastLine
  }
}

function withoutBlockquotePrefix(line: string): string {
  return line.replace(/^ {0,3}(?:>[ \t]?)+/, "")
}

function maskIndentedCode(source: string, chars: string[]): void {
  const lines = linesOf(source)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const indentation = leadingIndentColumns(line.text)
    if (indentation < 4) continue

    // List content is indented relative to its marker. Four absolute spaces
    // can therefore still be ordinary nested Markdown; only mask it as code
    // once it reaches four columns beyond the active list content indent.
    const listIndent = activeListContentIndent(lines, index)
    if (listIndent !== null && indentation < listIndent + 4) continue
    maskRange(chars, line.start, line.end)
  }
}

function activeListContentIndent(lines: readonly Line[], index: number): number | null {
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    const text = lines[candidate].text
    if (!text.trim()) continue

    const marker = /^( {0,3})(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(text)
    if (marker) return textColumns(marker[0])
    if (leadingIndentColumns(text) === 0) return null
  }
  return null
}

function leadingIndentColumns(text: string): number {
  let columns = 0
  for (const character of text) {
    if (character === " ") columns += 1
    else if (character === "\t") columns += 4 - (columns % 4)
    else break
  }
  return columns
}

function textColumns(text: string): number {
  let columns = 0
  for (const character of text) {
    columns += character === "\t" ? 4 - (columns % 4) : 1
  }
  return columns
}

function maskEscapes(chars: string[]): void {
  const source = chars.join("")
  for (let index = 0; index + 1 < chars.length; index += 1) {
    if (chars[index] !== "\\" || chars[index + 1] === "\n") continue

    // A line-leading `\[` is itself a display-math delimiter, not an
    // escaped ordinary bracket. Keep that opener visible for the math scan;
    // doubled backslashes and bracket text without delimiter whitespace still
    // follow the normal escape-masking path below.
    if (isDisplayMathBracketOpener(source, index)) continue

    if (chars[index + 1] === "<") {
      const opener = /^<([a-z][\w-]*)\b[^<>\n]*>/i.exec(source.slice(index + 1))
      if (opener) {
        const openerEnd = index + 1 + opener[0].length
        maskRange(chars, index, openerEnd)

        if (!/\/\s*>$/.test(opener[0])) {
          const tag = opener[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          const closing = new RegExp(`</${tag}\\s*>`, "i").exec(source.slice(openerEnd))
          if (closing?.index !== undefined) {
            const closingStart = openerEnd + closing.index
            maskRange(chars, closingStart, closingStart + closing[0].length)
          }
        }

        index = openerEnd - 1
        continue
      }
    }

    if (chars[index + 1] === "`" || chars[index + 1] === "~") {
      const marker = chars[index + 1]
      let runLength = 1
      while (chars[index + 1 + runLength] === marker) runLength += 1
      if (runLength >= 3) {
        let end = index + 1 + runLength
        while (end < chars.length && chars[end] !== "\n") end += 1
        maskRange(chars, index, end)
        index = end - 1
        continue
      }
    }
    chars[index] = " "
    chars[index + 1] = " "
    index += 1
  }
}

function isDisplayMathBracketOpener(source: string, index: number): boolean {
  if (source[index + 1] !== "[") return false
  const lineStart = source.lastIndexOf("\n", index - 1) + 1
  if (!/^ {0,3}$/.test(source.slice(lineStart, index))) return false
  const after = source[index + 2]
  return after === undefined || after === "\n" || after === " " || after === "\t"
}

function maskInlineCode(chars: string[]): void {
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] !== "`") continue

    let openerLength = 1
    while (chars[index + openerLength] === "`") openerLength += 1

    let close = index + openerLength
    while (close < chars.length) {
      if (chars[close] !== "`") {
        close += 1
        continue
      }
      let closingLength = 1
      while (chars[close + closingLength] === "`") closingLength += 1
      if (closingLength === openerLength) break
      close += closingLength
    }

    if (close >= chars.length) {
      index += openerLength - 1
      continue
    }

    const end = close + openerLength
    maskRange(chars, index, end)
    index = end - 1
  }
}

function maskRawHtmlBlocks(
  chars: string[],
  report: ReportRisk,
): void {
  const current = chars.join("")
  const lines = linesOf(current)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const special = /^ {0,3}(?:<\?|<![A-Z]|<!\[CDATA\[)/i.test(line.text)
    if (special) {
      report("raw-html", line.start, line.end)
      maskRange(chars, line.start, line.end)
      continue
    }

    const closingOnly = /^ {0,3}<\/([a-z][\w-]*)\s*>\s*$/i.exec(line.text)
    if (closingOnly && RAW_BLOCK_TAGS.has(closingOnly[1].toLowerCase())) {
      report("raw-html", line.start, line.end)
      maskRange(chars, line.start, line.end)
      continue
    }

    // CommonMark raw-block starts do not require the opening tag to finish on
    // the same line. Root-level indented code was already masked above, so
    // allowing retained indentation here also covers normal list content.
    const opener = /^[ \t]*<([a-z][\w-]*)(?=[\s/>]|$)/i.exec(line.text)
    const tag = opener?.[1].toLowerCase()
    if (!tag || !RAW_BLOCK_TAGS.has(tag)) continue

    let lastLine = lineIndex
    const closePattern = new RegExp(`</${tag}\\s*>`, "i")
    if (
      !VOID_RAW_BLOCK_TAGS.has(tag) &&
      !closePattern.test(line.text) &&
      !/\/\s*>\s*$/.test(line.text)
    ) {
      for (let candidate = lineIndex + 1; candidate < lines.length; candidate += 1) {
        lastLine = candidate
        if (
          closePattern.test(lines[candidate].text) ||
          lines[candidate].text.trim() === ""
        ) {
          break
        }
      }
    }

    report("raw-html", line.start, lines[lastLine].end)
    const end = lastLine + 1 < lines.length ? lines[lastLine + 1].start : chars.length
    maskRange(chars, line.start, end)
    lineIndex = lastLine
  }
}

function detectInlineLinkTitles(text: string, report: ReportRisk): void {
  for (let labelStart = 0; labelStart < text.length; labelStart += 1) {
    if (text[labelStart] !== "[") continue

    const labelEnd = matchingLabelEnd(text, labelStart)
    if (labelEnd < 0 || text[labelEnd + 1] !== "(") continue

    let depth = 0
    let quote: '"' | "'" | null = null
    let close = -1
    const start = labelEnd + 2

    for (let index = start; index < text.length; index += 1) {
      const char = text[index]
      if (quote) {
        if (char === quote && text[index - 1] !== "\\") quote = null
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
      } else if (char === "(") {
        depth += 1
      } else if (char === ")") {
        if (depth === 0) {
          close = index
          break
        }
        depth -= 1
      }
    }

    if (close < 0) continue
    const inside = text.slice(start, close)
    if (/(?:^|\s)(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\))\s*$/.test(inside)) {
      report("link-title", labelStart > 0 && text[labelStart - 1] === "!" ? labelStart - 1 : labelStart, close + 1)
      labelStart = close
    }
  }
}

function matchingLabelEnd(text: string, start: number): number {
  let depth = 1
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "[") depth += 1
    if (text[index] !== "]") continue
    depth -= 1
    if (depth === 0) return index
  }
  return -1
}

function detectMdx(text: string, report: ReportRisk): void {
  // A tag start is sufficient, including incomplete and multiline components.
  reportMatches(text, /<\/?[A-Z][\w.-]*(?=[\s/>])/g, "mdx", report)
  reportMatches(text, /<\/?>/g, "mdx", report)
  reportMatches(text, /^(?:import\s+(?:[^\n]+\s+from\s+|["'])|export\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|\{))/gm, "mdx", report)
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue
    let depth = 1
    for (let index = start + 1; index < text.length; index += 1) {
      if (text[index] === "{") depth += 1
      if (text[index] !== "}") continue
      depth -= 1
      if (depth === 0) {
        const expression = text.slice(start + 1, index).trim()
        if (looksLikeMdxExpression(expression)) {
          report("mdx", start, index + 1)
          start = index
        }
        break
      }
    }
  }
}

function looksLikeMdxExpression(expression: string): boolean {
  // Bare placeholders and prose set notation round-trip through the pinned
  // BlockNote converter. Reserve raw mode for clear JavaScript/MDX signals.
  return /\/\*|=>|&&|\|\||[+*/%?:=]/.test(expression)
}

function detectAlignedTableDelimiters(text: string, report: ReportRisk): void {
  for (const line of linesOf(text)) {
    const trimmed = line.text.trim().replace(/^\|/, "").replace(/\|$/, "")
    const cells = trimmed.split("|").map((cell) => cell.trim())
    if (
      cells.length >= 2 &&
      cells.every((cell) => /^:?-{3,}:?$/.test(cell)) &&
      cells.some((cell) => cell.startsWith(":") || cell.endsWith(":"))
    ) report("table-alignment", line.start, line.end)
  }
}

function detectMultiParagraphQuotes(text: string, report: ReportRisk): void {
  let start = 0
  let end = 0
  let sawContent = false
  let sawQuotedBlank = false
  let multipleParagraphs = false
  // Sentinel flushes a quote at EOF as well as those ended by ordinary prose.
  for (const line of [...linesOf(text), { text: "", start: text.length, end: text.length }]) {
    const quote = /^ {0,3}>[ \t]?(.*)$/.exec(line.text)
    if (!quote) {
      if (multipleParagraphs) report("multi-paragraph-quote", start, end)
      sawContent = false
      sawQuotedBlank = false
      multipleParagraphs = false
      continue
    }
    end = line.end
    if (quote[1].trim() === "") {
      if (sawContent) sawQuotedBlank = true
    } else {
      if (!sawContent) start = line.start
      if (sawContent && sawQuotedBlank) multipleParagraphs = true
      sawContent = true
    }
  }
}
