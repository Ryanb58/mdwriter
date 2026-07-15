/** Pure helpers for case-insensitive, non-overlapping in-note Find. */

/**
 * Start offsets of every case-insensitive, non-overlapping occurrence of
 * `query` in `text`, in document order. Empty query → no matches.
 */
export function findOccurrences(text: string, query: string): number[] {
  return findRanges(text, query).map((range) => range.from)
}

/** Exact source ranges for raw-mode Find. */
export function findRanges(text: string, query: string): Array<{ from: number; to: number }> {
  if (!query) return []

  const foldedText = text.toLowerCase()
  const foldedQuery = query.toLowerCase()
  const offsetMap = foldedText.length === text.length
    ? null
    : buildFoldedOffsetMap(text)
  const ranges: Array<{ from: number; to: number }> = []
  let foldedFrom = 0

  while ((foldedFrom = foldedText.indexOf(foldedQuery, foldedFrom)) >= 0) {
    const foldedTo = foldedFrom + foldedQuery.length
    ranges.push(offsetMap
      ? {
          from: offsetMap.starts[foldedFrom],
          to: offsetMap.ends[foldedTo - 1],
        }
      : { from: foldedFrom, to: foldedTo })
    foldedFrom = foldedTo
  }

  return ranges
}

function buildFoldedOffsetMap(text: string): { starts: number[]; ends: number[] } {
  const starts: number[] = []
  const ends: number[] = []
  let originalFrom = 0

  // Some Unicode characters lowercase into multiple UTF-16 code units. Map
  // each expanded unit back to the complete original character so a match
  // never highlights a shifted or partial glyph.
  for (const character of text) {
    const originalTo = originalFrom + character.length
    const foldedLength = character.toLowerCase().length
    for (let index = 0; index < foldedLength; index += 1) {
      starts.push(originalFrom)
      ends.push(originalTo)
    }
    originalFrom = originalTo
  }

  return { starts, ends }
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
