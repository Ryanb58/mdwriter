/**
 * Detect whether the caret is inside an open note reference (either `[[…` or
 * `@…`) so the message input can show its note picker. Pure for tests.
 *
 * Both triggers funnel into the same record shape — `start`/`end` mark the
 * span that the popover will replace when a note is chosen, and `query` is
 * the text the user has typed so far. The chosen note is always inserted as
 * `[[name]]`, so the two triggers are just alternate ways to summon the
 * picker.
 */
export type WikilinkTrigger = {
  /** Index of the first trigger character (`[` of `[[` or `@`). */
  start: number
  /** Caret index (where the next char would be inserted). */
  end: number
  /** Text between the trigger and the caret. */
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
 * Look back from the caret for an `@` that starts a note reference. The `@`
 * must be preceded by start-of-text, whitespace, or an opening-bracket-style
 * character — otherwise `user@host` would arm the picker. The query is the
 * run of non-space characters between the `@` and the caret; we cancel on
 * whitespace because mentions are single tokens, not phrases.
 */
export function detectAtTrigger(
  text: string,
  caret: number,
  maxLen = 60,
): WikilinkTrigger | null {
  if (caret < 1) return null
  const limit = Math.max(0, caret - maxLen)
  for (let i = caret - 1; i >= limit; i--) {
    const ch = text[i]
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "[" || ch === "]") return null
    if (ch === "@") {
      const prev = i === 0 ? "" : text[i - 1]
      const allowedPrev = prev === "" || /[\s([{<,;]/.test(prev)
      if (!allowedPrev) return null
      return { start: i, end: caret, query: text.slice(i + 1, caret) }
    }
  }
  return null
}

/**
 * Try both note-reference triggers and return whichever matches. When both
 * could match (the input contains `[[a@b`), we prefer the one whose `start`
 * is closer to the caret — that's the more recently opened mention.
 */
export function detectMentionTrigger(
  text: string,
  caret: number,
): WikilinkTrigger | null {
  const w = detectWikilinkTrigger(text, caret)
  const a = detectAtTrigger(text, caret)
  if (!w) return a
  if (!a) return w
  return a.start > w.start ? a : w
}

/**
 * Splice the wikilink replacement into `text`, returning the new value and the
 * caret position to set afterwards (just past the closing `]]`). Works for
 * both `[[` and `@` triggers because the trigger's `start`/`end` already
 * cover the span to replace.
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
