// Defensive walker over BlockNote's block tree. We deliberately type these
// as `unknown`/`any` and probe shapes at runtime — BlockNote's generated
// Block type depends on schema generics that don't apply cleanly outside
// the BlockEditor, and a permissive walker is easier to keep stable.

type AnyBlock = {
  id?: string
  type?: string
  content?: unknown
  children?: AnyBlock[]
  props?: Record<string, unknown>
}

/**
 * Pulls plain text out of a block's inline content. Handles BlockNote's text
 * runs, links (which carry a nested content array), and our wikilink atom
 * (which renders `alias || target`).
 */
export function extractBlockText(block: AnyBlock | null | undefined): string {
  if (!block) return ""
  const content = block.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  let out = ""
  for (const c of content) {
    if (!c || typeof c !== "object") continue
    const item = c as Record<string, unknown>
    if (typeof item.text === "string") {
      out += item.text
      continue
    }
    if (item.type === "wikilink") {
      const props = (item.props ?? {}) as Record<string, unknown>
      const alias = typeof props.alias === "string" ? props.alias : ""
      const target = typeof props.target === "string" ? props.target : ""
      out += alias || target
      continue
    }
    // Links and other inline containers carry their own content array.
    if (Array.isArray(item.content)) {
      out += extractBlockText({ content: item.content })
    }
  }
  return out
}

/**
 * Walk blocks in document order, counting case-insensitive occurrences of
 * `needle`. Returns the block containing the `occurrence`-th match (0-indexed)
 * and its `localIndex` — which match within that block to highlight.
 *
 * When the doc has been edited since the search ran and the requested
 * occurrence no longer exists, falls back to the last available match so the
 * user still lands somewhere reasonable. Returns null only when there are no
 * matches at all.
 */
export function findNthBlockMatch<T extends AnyBlock>(
  blocks: readonly T[] | undefined | null,
  needle: string,
  occurrence: number,
): { block: T; localIndex: number } | null {
  if (!blocks || !needle) return null
  const n = needle.toLowerCase()
  if (!n) return null
  const target = Math.max(0, Math.floor(occurrence))

  let cumulative = 0
  let lastMatch: { block: T; localIndex: number } | null = null

  function walk(list: readonly T[]): { block: T; localIndex: number } | null {
    for (const b of list) {
      const text = extractBlockText(b).toLowerCase()
      const inBlock = countOccurrences(text, n)
      if (inBlock > 0) {
        // The Nth global match might be inside this block.
        const local = target - cumulative
        if (local >= 0 && local < inBlock) {
          return { block: b, localIndex: local }
        }
        lastMatch = { block: b, localIndex: inBlock - 1 }
        cumulative += inBlock
      }
      if (Array.isArray(b.children) && b.children.length > 0) {
        const inner = walk(b.children as unknown as readonly T[])
        if (inner) return inner
      }
    }
    return null
  }

  return walk(blocks) ?? lastMatch
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let i = 0
  while ((i = haystack.indexOf(needle, i)) >= 0) {
    count++
    i += needle.length
  }
  return count
}
