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
 * Depth-first search for the first block whose plain text contains `needle`
 * (case-insensitive). Returns null if nothing matches.
 */
export function findBlockContaining<T extends AnyBlock>(
  blocks: readonly T[] | undefined | null,
  needle: string,
): T | null {
  const n = needle.toLowerCase()
  if (!n) return null
  if (!blocks) return null
  for (const b of blocks) {
    const text = extractBlockText(b).toLowerCase()
    if (text.includes(n)) return b
    if (Array.isArray(b.children) && b.children.length > 0) {
      const inner = findBlockContaining(b.children as T[], needle)
      if (inner) return inner
    }
  }
  return null
}
