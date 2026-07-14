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
  | "frontmatter-error"

export type MarkdownRisk = { code: MarkdownRiskCode; label: string }

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
  "ambiguous-frontmatter": "an unclosed frontmatter fence",
  "frontmatter-error": "invalid frontmatter",
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
  const source = body.replace(/\r\n?/g, "\n")
  const found = new Set<MarkdownRiskCode>()
  const chars = [...source]

  detectAmbiguousFrontmatter(source, found)
  maskFencedCode(source, chars, found)
  maskIndentedCode(source, chars)
  maskEscapes(chars)
  maskInlineCode(chars)
  maskRawHtmlBlocks(chars, found)

  const visible = chars.join("")

  if (/<!--[\s\S]*?-->/.test(visible)) found.add("html-comment")
  if (/\[\^[^\]\n]+\]/.test(visible)) found.add("footnote")
  if (/^ {0,3}\[(?!\^)[^\]\n]+\]:\s*\S+/m.test(visible)) {
    found.add("reference-definition")
  }
  if (hasInlineLinkTitle(visible)) found.add("link-title")
  if (hasMdx(visible)) found.add("mdx")
  if (hasInlineHtml(visible)) found.add("inline-html")
  if (hasDisplayMath(visible)) found.add("math")
  if (/^ {0,3}:{3,}(?:[^:]|$)/m.test(visible)) found.add("directive")
  if (hasAlignedTableDelimiter(visible)) found.add("table-alignment")
  if (hasMultiParagraphQuote(visible)) found.add("multi-paragraph-quote")

  return RISK_ORDER.filter((code) => found.has(code)).map((code) => ({
    code,
    label: RISK_LABELS[code],
  }))
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
  found: Set<MarkdownRiskCode>,
): void {
  const lines = source.split("\n")
  if (lines[0]?.trim() !== "---") return
  if (!lines.slice(1).some((line) => line.trim() === "---")) {
    found.add("ambiguous-frontmatter")
  }
}

function maskFencedCode(
  source: string,
  chars: string[],
  found: Set<MarkdownRiskCode>,
): void {
  const lines = linesOf(source)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const match = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line.text)
    if (!match) continue

    const marker = match[1]
    const info = match[2].trim()
    // A backtick fence info string cannot itself contain a backtick. Treat
    // such a line as an inline code span so the inline masker can handle it.
    if (marker[0] === "`" && info.includes("`")) continue

    const tokens = info ? info.split(/\s+/) : []
    const language = tokens[0]?.toLowerCase() ?? ""
    if (["math", "latex", "katex"].includes(language)) found.add("math")
    if (
      tokens.length > 1 ||
      (tokens.length === 1 && (/^[{[]/.test(tokens[0]) || tokens[0].includes("=")))
    ) {
      found.add("code-fence-metadata")
    }

    let lastLine = lines.length - 1
    for (let candidate = lineIndex + 1; candidate < lines.length; candidate += 1) {
      const closing = /^ {0,3}(`+|~+)\s*$/.exec(lines[candidate].text)
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

function maskIndentedCode(source: string, chars: string[]): void {
  for (const line of linesOf(source)) {
    if (/^(?: {4,}|\t)/.test(line.text)) {
      maskRange(chars, line.start, line.end)
    }
  }
}

function maskEscapes(chars: string[]): void {
  for (let index = 0; index + 1 < chars.length; index += 1) {
    if (chars[index] !== "\\" || chars[index + 1] === "\n") continue
    chars[index] = " "
    chars[index + 1] = " "
    index += 1
  }
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
  found: Set<MarkdownRiskCode>,
): void {
  const current = chars.join("")
  const lines = linesOf(current)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const opener = /^ {0,3}<([a-z][\w-]*)\b[^>]*>/i.exec(line.text)
    const tag = opener?.[1].toLowerCase()
    if (!tag || !RAW_BLOCK_TAGS.has(tag)) continue

    found.add("raw-html")
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

    const end = lastLine + 1 < lines.length ? lines[lastLine + 1].start : chars.length
    maskRange(chars, line.start, end)
    lineIndex = lastLine
  }
}

function hasInlineLinkTitle(text: string): boolean {
  return /!?\[[^\]\n]*\]\([^\n)]*\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\n)]*\))\s*\)/.test(
    text,
  )
}

function hasMdx(text: string): boolean {
  const jsxTag = /<\/?[A-Z][\w.-]*(?:\s[^<>\n]*?)?\s*\/?>/
  const expression = /\{[A-Za-z_$][^{}\n]*\}/
  return jsxTag.test(text) || expression.test(text)
}

function hasInlineHtml(text: string): boolean {
  const tag = /<\/?([a-z][\w-]*)(?:\s[^<>\n]*?)?\s*\/?>/g
  for (const match of text.matchAll(tag)) {
    if (!RAW_BLOCK_TAGS.has(match[1].toLowerCase())) return true
  }
  return false
}

function hasDisplayMath(text: string): boolean {
  return /^ {0,3}\$\$(?:\s.*)?$/m.test(text) || /^ {0,3}\\\[(?:\s.*)?$/m.test(text)
}

function hasAlignedTableDelimiter(text: string): boolean {
  return text.split("\n").some((line) => {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "")
    const cells = trimmed.split("|").map((cell) => cell.trim())
    return (
      cells.length >= 2 &&
      cells.every((cell) => /^:?-{3,}:?$/.test(cell)) &&
      cells.some((cell) => cell.startsWith(":") || cell.endsWith(":"))
    )
  })
}

function hasMultiParagraphQuote(text: string): boolean {
  let insideQuote = false
  let sawContent = false
  let sawQuotedBlank = false

  for (const line of text.split("\n")) {
    const quote = /^ {0,3}>[ \t]?(.*)$/.exec(line)
    if (!quote) {
      insideQuote = false
      sawContent = false
      sawQuotedBlank = false
      continue
    }

    if (!insideQuote) insideQuote = true
    if (quote[1].trim() === "") {
      if (sawContent) sawQuotedBlank = true
    } else {
      if (sawContent && sawQuotedBlank) return true
      sawContent = true
    }
  }

  return false
}
