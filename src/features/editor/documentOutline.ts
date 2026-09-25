import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import type { Nodes } from "mdast"

export type OutlineHeading = {
  /** UTF-16 source offset and 1-based line in the full, canonical file. */
  from: number
  line: number
  column: number
  level: number
  title: string
  /** Actual ancestor count, not level - 1 (documents may skip levels). */
  indent: number
}

const parser = unified().use(remarkParse).use(remarkGfm)

function textContent(node: Nodes): string {
  if (node.type === "html") return ""
  if ("value" in node) return node.value
  if ("alt" in node) return node.alt ?? ""
  if ("children" in node) return node.children.map(textContent).join("")
  return ""
}

function lineBreakLengthAt(text: string, index: number): number {
  if (text.startsWith("\r\n", index)) return 2
  return text[index] === "\r" || text[index] === "\n" ? 1 : 0
}

/** Like documentAnalysis's envelope scanner, recognize CR, LF and CRLF at
 * each boundary independently. Do not normalize the source: both UTF-16
 * offsets and Markdown/CodeMirror line numbers must survive mixed endings. */
function frontmatterEnd(text: string): number {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0
  if (text.slice(start, start + 3) !== "---") return 0
  const openerEnd = start + 3
  const openerBreak = lineBreakLengthAt(text, openerEnd)
  if (!openerBreak) return 0

  let cursor = openerEnd + openerBreak
  while (cursor < text.length) {
    let lineEnd = cursor
    while (lineEnd < text.length && !lineBreakLengthAt(text, lineEnd)) lineEnd++
    if (/^(?:---|\.\.\.)[ \t]*$/.test(text.slice(cursor, lineEnd))) {
      return lineEnd + lineBreakLengthAt(text, lineEnd)
    }
    cursor = lineEnd + lineBreakLengthAt(text, lineEnd)
  }
  // Preserve the existing treatment of an unclosed envelope as Markdown.
  return 0
}

/** Parse, never rewrite, the canonical Markdown. Mask YAML so positions stay
 * exact, including mixed line endings, Unicode, and heading-like YAML. */
export function parseOutline(text: string): OutlineHeading[] {
  const end = frontmatterEnd(text)
  const source = end ? text.slice(0, end).replace(/[^\r\n]/g, " ") + text.slice(end) : text
  const headings: OutlineHeading[] = []
  const ancestors: number[] = []
  function visit(node: Nodes) {
    if (node.type === "heading" && node.position) {
      while (ancestors.length && ancestors[ancestors.length - 1] >= node.depth) ancestors.pop()
      headings.push({
        from: node.position.start.offset!,
        line: node.position.start.line,
        column: node.position.start.column - 1,
        level: node.depth,
        title: textContent(node).replace(/\s+/g, " ").trim() || "Untitled heading",
        indent: ancestors.length,
      })
      ancestors.push(node.depth)
    }
    if ("children" in node) node.children.forEach(visit)
  }
  visit(parser.parse(source))
  return headings
}

/** Last section starting at/before a cursor or viewport anchor; no section
 * before the first heading. Also works with sorted block/viewport positions. */
export function sectionAt(positions: readonly number[], anchor: number): number {
  let lo = 0, hi = positions.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (positions[mid] <= anchor) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

type OutlineBlock = {
  id: string
  type: string
  props?: Record<string, unknown>
  children?: OutlineBlock[]
}

export function flattenOutlineBlocks(blocks: readonly OutlineBlock[]): OutlineBlock[] {
  return blocks.flatMap((block) => [block, ...flattenOutlineBlocks(block.children ?? [])])
}

/** Match headings by document order, never by text (duplicate titles are legal).
 * Do not jump into an unrelated block while async Markdown export/hydration
 * has a different heading structure from the canonical buffer. */
export function outlineBlockIds(headings: readonly OutlineHeading[], blocks: readonly OutlineBlock[]): string[] {
  const rendered = flattenOutlineBlocks(blocks).filter((block) => block.type === "heading")
  if (rendered.length !== headings.length || rendered.some((block, i) => block.props?.level !== headings[i].level)) return []
  return rendered.map((block) => block.id)
}

/** CodeMirror normalizes CRLF to LF internally. Resolve source line/column
 * against the live editor rather than dispatching a canonical byte offset. */
export function rawHeadingPosition(
  heading: OutlineHeading,
  doc: { lines: number; line: (number: number) => { from: number; to: number } },
): number | null {
  if (heading.line < 1 || heading.line > doc.lines) return null
  const line = doc.line(heading.line)
  const position = line.from + heading.column
  return position <= line.to ? position : null
}
