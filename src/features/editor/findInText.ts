/** Pure helpers for case-insensitive, non-overlapping in-note Find. */

/**
 * Start offsets of every case-insensitive, non-overlapping occurrence of
 * `query` in `text`, in document order. Empty query → no matches.
 */
export function findOccurrences(text: string, query: string): number[] {
  if (!query) return []
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  const out: number[] = []
  let i = 0
  while ((i = hay.indexOf(needle, i)) >= 0) {
    out.push(i)
    i += needle.length
  }
  return out
}

/** Exact source ranges for raw-mode Find. */
export function findRanges(text: string, query: string): Array<{ from: number; to: number }> {
  return findOccurrences(text, query).map((from) => ({
    from,
    to: from + query.length,
  }))
}

/** 1-based line number containing character offset `pos` in `text`. */
export function lineAt(text: string, pos: number): number {
  let line = 1
  const end = Math.min(Math.max(0, pos), text.length)
  for (let i = 0; i < end; i++) {
    if (text[i] === "\n") line++
  }
  return line
}

/**
 * Wrap `i` into `[0, total)` so next/previous navigation cycles through
 * matches. Handles negative indices (previous from the first match wraps to
 * the last). `total <= 0` → 0.
 */
export function wrapIndex(i: number, total: number): number {
  if (total <= 0) return 0
  return ((i % total) + total) % total
}
