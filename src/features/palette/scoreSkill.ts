/**
 * VS Code–style command-palette scorer.
 *
 * The cmdk default scorer is fuzzy-subsequence (any letters anywhere, in
 * order) which makes typing "compe" match a row like "Extract …
 * com**p**on**e**nts" via letter pickup across word boundaries. That feels
 * noisy in a command palette where users expect prefix-ish typing to filter
 * narrowly.
 *
 * This scorer is **strict contiguous substring per token**: split the query
 * on whitespace, each token must appear as a contiguous substring in either
 * the name or the description. Score by:
 *   - match in name >> match in description
 *   - prefix > word-boundary > mid-word
 *   - earlier position in haystack > later
 *
 * The output is in [0, 1]; cmdk treats `> 0` as "include this row" and uses
 * the value to sort.
 */

/**
 * `value` format from CommandMode: `<name>__<source>` (uniqueness for cmdk's
 * selection state). `keywords` carry `[description, source]`. We score
 * against the name (extracted from value) and the description; source is
 * available for filter-by-source UX later but doesn't contribute to scoring
 * today.
 */
export function scoreSkillMatch(
  value: string,
  search: string,
  keywords?: string[],
): number {
  const trimmed = search.trim()
  if (!trimmed) return 1

  const name = value.split("__", 1)[0]
  const description = keywords?.[0] ?? ""
  const nameL = name.toLowerCase()
  const descL = description.toLowerCase()
  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 1

  let total = 0
  for (const token of tokens) {
    const nameScore = matchScore(nameL, token)
    const descScore = matchScore(descL, token)
    // Description matches are worth ~40% of name matches at the same quality.
    const best = Math.max(nameScore, descScore * 0.4)
    if (best === 0) return 0
    total += best
  }
  return total / tokens.length
}

/**
 * Score one token against one haystack. Returns 0 when the token isn't a
 * contiguous substring; otherwise a value in (0, 1] favoring early-position
 * and word-boundary matches.
 */
function matchScore(haystack: string, token: string): number {
  const idx = haystack.indexOf(token)
  if (idx < 0) return 0

  // Base: earlier in the string = higher.
  const positionWeight = 1 - idx / Math.max(haystack.length, 1)

  // Quality of the boundary the match starts on.
  let boundary: number
  if (idx === 0) {
    boundary = 1.0 // strong prefix
  } else {
    const prev = haystack[idx - 1]
    if (prev === " " || prev === "-" || prev === "_" || prev === "/" || prev === ".") {
      boundary = 0.75 // word-start
    } else {
      boundary = 0.35 // mid-word
    }
  }

  // Bonus for matching the entire haystack exactly.
  const exact = idx === 0 && token.length === haystack.length ? 0.1 : 0

  // Blend boundary (dominant) with position. Cap at 1.
  return Math.min(1, boundary * 0.75 + positionWeight * 0.25 + exact)
}
