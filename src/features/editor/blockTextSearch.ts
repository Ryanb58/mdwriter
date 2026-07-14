import type {
  BlockTextIndex,
  RenderedBlockEntry,
  RenderedBlockMatch,
} from "../../lib/store"

// BlockNote's Block type carries schema-dependent generics that make a small,
// read-only text walker needlessly hard to reuse. Keep this boundary narrow
// and probe only the stable runtime fields needed by Find.
type SearchableBlock = {
  id?: string
  type?: string
  content?: unknown
  children?: SearchableBlock[]
}

/** Extract the text BlockNote renders for one block, excluding source-only data. */
export function extractBlockText(block: SearchableBlock | null | undefined): string {
  if (!block) return ""
  return extractInlineText(block.content)
}

/** Build the session-only, display-order index used by Find in block mode. */
export function buildBlockTextIndex(
  path: string,
  docKey: string,
  blocks: readonly SearchableBlock[] | null | undefined,
): BlockTextIndex {
  const entries: RenderedBlockEntry[] = []

  function visit(list: readonly SearchableBlock[]) {
    for (const block of list) {
      if (typeof block.id === "string" && block.id) {
        entries.push({ blockId: block.id, text: extractBlockText(block) })
      }
      if (Array.isArray(block.children)) visit(block.children)
    }
  }

  if (blocks) visit(blocks)
  return { path, docKey, blocks: entries }
}

/** Find exact, case-insensitive, non-overlapping ranges in rendered block text. */
export function findRenderedBlockMatches(
  blocks: readonly RenderedBlockEntry[] | null | undefined,
  query: string,
): RenderedBlockMatch[] {
  if (!blocks || !query) return []
  const needle = query.toLowerCase()
  if (!needle) return []
  const matches: RenderedBlockMatch[] = []

  for (const block of blocks) {
    const haystack = block.text.toLowerCase()
    let from = 0
    while ((from = haystack.indexOf(needle, from)) >= 0) {
      const to = from + query.length
      matches.push({ ...block, from, to })
      from = to
    }
  }

  return matches
}

function extractInlineText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) {
    const value = asRecord(content)
    if (value.type === "tableCell" && Array.isArray(value.content)) {
      return extractInlineText(value.content)
    }
    if (value.type !== "tableContent" || !Array.isArray(value.rows)) return ""
    let tableText = ""
    for (const rowValue of value.rows) {
      const row = asRecord(rowValue)
      if (!Array.isArray(row.cells)) continue
      for (const cell of row.cells) tableText += extractInlineText(cell)
    }
    return tableText
  }

  let text = ""
  for (const candidate of content) {
    if (!candidate || typeof candidate !== "object") continue
    const item = candidate as Record<string, unknown>
    if (typeof item.text === "string") {
      text += item.text
      continue
    }
    if (item.type === "wikilink") {
      const props = asRecord(item.props)
      const alias = typeof props.alias === "string" ? props.alias : ""
      const target = typeof props.target === "string" ? props.target : ""
      text += alias || target
      continue
    }
    if (Array.isArray(item.content)) text += extractInlineText(item.content)
  }
  return text
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {}
}
