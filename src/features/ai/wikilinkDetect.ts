/**
 * Detect whether the caret is inside an open `[[…` wikilink so the message
 * input can show its note picker. Pure for tests.
 */
export type WikilinkTrigger = {
  /** Index of the `[` that opened the link. */
  start: number
  /** Caret index (where the next char would be inserted). */
  end: number
  /** Text between `[[` and the caret. */
  query: string
}

/**
 * Look back from the caret for an unclosed `[[`. The trigger is cancelled if
 * we hit `]`, a newline, or another `[` (a single bracket should not arm the
 * autocomplete), or if the run is longer than `maxLen` chars — that's almost
 * always a paste, not a live wikilink.
 */
export function detectWikilinkTrigger(
  text: string,
  caret: number,
  maxLen = 80,
): WikilinkTrigger | null {
  if (caret < 2) return null
  const limit = Math.max(0, caret - maxLen)
  // Scan back char-by-char so we can reject early on cancelling characters.
  for (let i = caret - 1; i >= limit; i--) {
    const ch = text[i]
    if (ch === "]" || ch === "\n") return null
    if (ch === "[") {
      if (i > 0 && text[i - 1] === "[") {
        const start = i - 1
        const query = text.slice(start + 2, caret)
        // `[[]…` with anything other than note-name characters? still allow —
        // fuzzy search will just match nothing. But disallow embedded `[`.
        if (query.includes("[")) return null
        return { start, end: caret, query }
      }
      return null
    }
  }
  return null
}

/**
 * Splice the wikilink replacement into `text`, returning the new value and the
 * caret position to set afterwards (just past the closing `]]`).
 */
export function applyWikilinkSelection(
  text: string,
  trigger: WikilinkTrigger,
  noteName: string,
): { value: string; caret: number } {
  const before = text.slice(0, trigger.start)
  const after = text.slice(trigger.end)
  const insert = `[[${noteName}]]`
  return { value: before + insert + after, caret: before.length + insert.length }
}
