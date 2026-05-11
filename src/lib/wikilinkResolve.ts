import type { VaultNote } from "./vaultNotes"

/**
 * A parsed wikilink target like `Three laws of motion`, `notes/foo.md`,
 * or `Three laws of motion|3 laws` (with alias). The `.md` extension and
 * any `|alias` are stripped from `target`; the alias is stashed separately
 * for display.
 */
export type ParsedWikilink = {
  target: string
  alias: string | null
}

/** Strip a trailing `.md` or `.markdown` (case-insensitive). */
export function stripMdExt(s: string): string {
  return s.replace(/\.(md|markdown)$/i, "")
}

/**
 * Parse the inside of `[[ ... ]]`. Splits on the first `|` for alias.
 * Leading/trailing whitespace inside the brackets is trimmed.
 */
export function parseWikilink(inner: string): ParsedWikilink {
  const pipe = inner.indexOf("|")
  if (pipe < 0) return { target: stripMdExt(inner.trim()), alias: null }
  return {
    target: stripMdExt(inner.slice(0, pipe).trim()),
    alias: inner.slice(pipe + 1).trim() || null,
  }
}

/**
 * Resolve a wikilink target (e.g. `Three laws of motion`, `folder/note`,
 * `note.md`) against the vault's flat note list. Tries, in order:
 *   1. Exact relative path match (with or without `.md`).
 *   2. Path suffix match — `folder/note` resolves `…/folder/note.md`.
 *   3. Filename stem match — `Three laws of motion` resolves any note whose
 *      basename (without extension) matches.
 *
 * All comparisons are case-insensitive. Returns the first match in tree
 * order, or `null` if no match.
 */
export function resolveLinkTarget(
  rawTarget: string,
  notes: VaultNote[],
): VaultNote | null {
  const target = stripMdExt(decodeTarget(rawTarget).trim())
  if (!target) return null
  const lc = target.toLowerCase()
  // Normalize backslashes for windows-friendly inputs.
  const lcSlash = lc.replace(/\\/g, "/")

  // Pass 1: exact rel match.
  for (const n of notes) {
    const rel = stripMdExt(n.rel).toLowerCase()
    if (rel === lcSlash) return n
  }
  // Pass 2: path-suffix (e.g. "subdir/note" matches "a/b/subdir/note.md").
  if (lcSlash.includes("/")) {
    for (const n of notes) {
      const rel = stripMdExt(n.rel).toLowerCase()
      if (rel === lcSlash || rel.endsWith("/" + lcSlash)) return n
    }
  }
  // Pass 3: filename stem match.
  for (const n of notes) {
    if (n.name.toLowerCase() === lc) return n
  }
  return null
}

/**
 * A markdown link `[text](href)` is "internal" if it has no scheme and
 * doesn't look like a fragment or anchor. Roots like `/foo` are treated
 * as relative — we strip the leading slash and resolve from vault root.
 */
export function isInternalHref(href: string): boolean {
  if (!href) return false
  if (href.startsWith("#")) return false
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return false
  // Any scheme like `http:`, `https:`, `file:`, `wikilink:` is external.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false
  return true
}

/**
 * Decode an href that may be URL-encoded (`Three%20laws%20of%20motion.md`).
 * Falls back to the raw string if decode throws on malformed input.
 */
export function decodeTarget(href: string): string {
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}
