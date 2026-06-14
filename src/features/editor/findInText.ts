/**
 * Pure helpers for the in-document find bar (⌘F). Occurrence semantics
 * deliberately mirror the two consumers of `pendingScroll`:
 *
 * - `scrollViewToMatch` (raw mode) walks the full CM doc text.
 * - `findNthBlockMatch` (block mode) walks block text in document order.
 *
 * Both count case-insensitively and advance by the needle's length after a
 * hit (no overlapping matches), so we do the same here to keep the
 * occurrence index the find bar computes aligned with what each editor
 * lands on.
 */

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
