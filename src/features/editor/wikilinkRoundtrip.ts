/**
 * Markdown ↔ BlockNote round-trip helpers for wikilinks.
 *
 * BlockNote 0.50's markdown parser doesn't understand `[[target]]`; left
 * alone, it would get eaten by the link/text passes and the round-trip
 * would lose the syntax. The trick (borrowed from Tolaria) is to swap
 * `[[…]]` for a private Unicode sentinel before parsing, then walk the
 * resulting block tree and replace any text node containing the sentinel
 * with a real `wikilink` inline-content node.
 *
 * Serialization is handled by the inline spec's `toExternalHTML`, which
 * emits the literal `[[target|alias]]` as plain text. The `postprocess`
 * helper here is a safety net: if BlockNote's HTML→markdown step escapes
 * a bracket along the way (e.g. `\[\[…\]\]`), we unescape it.
 *
 * The sentinel uses U+2039/U+203A (single guillemets) which are unlikely
 * to appear in normal markdown and survive BlockNote's markdown round
 * trip as plain text.
 */
import type { PartialBlock, PartialInlineContent } from "@blocknote/core"
import { parseWikilink } from "../../lib/wikilinkResolve"

const TOKEN_OPEN = "‹WL:"
const TOKEN_CLOSE = "›"

function encode(inner: string): string {
  return TOKEN_OPEN + encodeURIComponent(inner) + TOKEN_CLOSE
}
function decode(encoded: string): string {
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

const TOKEN_REGEX = new RegExp(TOKEN_OPEN + "([^" + TOKEN_CLOSE + "]*)" + TOKEN_CLOSE, "g")
const WIKILINK_REGEX = /\[\[([^\[\]\r\n]+?)\]\]/g
const ESCAPED_WIKILINK_REGEX = /\\\[\\\[([^\[\]\r\n]+?)\\\]\\\]/g

/** Preprocess: replace `[[X]]` with sentinel tokens before parsing. */
export function preprocessWikilinks(md: string): string {
  return md.replace(WIKILINK_REGEX, (_m, inner) => encode(String(inner)))
}

/**
 * Postprocess on serialize: BlockNote's markdown export already emits
 * our wikilinks as bracketed text (via toExternalHTML), but some HTML→md
 * converters escape `[` to `\[`. Unescape those, and as a safety net
 * also map our sentinel back to brackets (the sentinel shouldn't appear
 * in normal flows, but if a user copies our serialized HTML around it
 * could end up in the document).
 */
export function postprocessWikilinks(md: string): string {
  return md
    .replace(ESCAPED_WIKILINK_REGEX, (_m, inner) => `[[${inner}]]`)
    .replace(TOKEN_REGEX, (_m, enc) => `[[${decode(String(enc))}]]`)
}

type AnyInline = PartialInlineContent<any, any>[number]

/**
 * Walk the parsed block tree and split any text node containing a wikilink
 * sentinel into a sequence of [text, wikilink, text, …] inline contents.
 * Recurses into children for nested blocks.
 */
export function hydrateWikilinkBlocks(blocks: PartialBlock[]): PartialBlock[] {
  return blocks.map((b) => hydrateBlock(b))
}

function hydrateBlock(block: PartialBlock): PartialBlock {
  const next = { ...block } as PartialBlock
  const content = (next as { content?: unknown }).content
  if (Array.isArray(content)) {
    const hydrated: AnyInline[] = []
    for (const inline of content as AnyInline[]) {
      if (
        inline &&
        typeof inline === "object" &&
        "type" in inline &&
        (inline as { type?: string }).type === "text" &&
        typeof (inline as { text?: unknown }).text === "string"
      ) {
        hydrated.push(...splitTextInline(inline as { type: "text"; text: string; styles?: unknown }))
      } else {
        hydrated.push(inline)
      }
    }
    ;(next as { content: AnyInline[] }).content = hydrated
  }
  const children = (next as { children?: unknown }).children
  if (Array.isArray(children)) {
    ;(next as { children: PartialBlock[] }).children = hydrateWikilinkBlocks(children as PartialBlock[])
  }
  return next
}

function splitTextInline(inline: { type: "text"; text: string; styles?: unknown }): AnyInline[] {
  const text = inline.text
  if (!text.includes(TOKEN_OPEN)) return [inline as AnyInline]
  const out: AnyInline[] = []
  let lastIdx = 0
  TOKEN_REGEX.lastIndex = 0
  for (let m = TOKEN_REGEX.exec(text); m; m = TOKEN_REGEX.exec(text)) {
    if (m.index > lastIdx) {
      out.push({
        ...(inline as object),
        type: "text",
        text: text.slice(lastIdx, m.index),
      } as AnyInline)
    }
    const { target, alias } = parseWikilink(decode(m[1] || ""))
    out.push({
      type: "wikilink",
      props: { target, alias: alias ?? "" },
    } as unknown as AnyInline)
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) {
    out.push({
      ...(inline as object),
      type: "text",
      text: text.slice(lastIdx),
    } as AnyInline)
  }
  return out
}
