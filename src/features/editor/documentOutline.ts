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

/** Parse, never rewrite, the canonical Markdown. Mask YAML so positions stay
 * exact, including CRLF, Unicode, and heading-like YAML comments/scalars. */
export function parseOutline(text: string): OutlineHeading[] {
  const frontmatter = text.match(/^\uFEFF?---\r?\n[\s\S]*?^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m)
  // `m` is needed for the closing fence, but only a fence at byte zero opens YAML.
  const source = frontmatter?.index === 0
    ? frontmatter[0].replace(/[^\r\n]/g, " ") + text.slice(frontmatter[0].length)
    : text
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
