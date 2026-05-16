/**
 * Slash commands let the user invoke a templated prompt without typing it
 * out. Triggered by `/` at the very start of the composer.
 *
 * A command has:
 *   - `name`   — the literal slash word the user types
 *   - `label`  — human-readable in the popover
 *   - `hint`   — short description
 *   - `build`  — produces the actual prompt text given the context the
 *                user is currently in (open note, selection)
 *
 * The resulting prompt is dropped into the composer where the user can tweak
 * it before sending — never auto-submitted.
 */
export type SlashContext = {
  currentNoteName: string | null
  hasSelection: boolean
}

export type SlashCommand = {
  name: string
  label: string
  hint: string
  build: (ctx: SlashContext) => string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "summarize",
    label: "Summarise",
    hint: "Summarise the current note or selection",
    build: (ctx) => {
      if (ctx.hasSelection) return "Summarise the selected text."
      if (ctx.currentNoteName) return `Summarise ${ctx.currentNoteName} in 3–5 bullet points.`
      return "Summarise the open note in 3–5 bullet points."
    },
  },
  {
    name: "rewrite",
    label: "Rewrite",
    hint: "Rewrite the selection for clarity",
    build: (ctx) => {
      if (ctx.hasSelection) {
        return "Rewrite the selected text for clarity. Keep the same meaning and approximate length."
      }
      return "Rewrite the open note for clarity. Keep the same meaning and approximate length."
    },
  },
  {
    name: "continue",
    label: "Continue writing",
    hint: "Pick up where the note leaves off",
    build: (ctx) => {
      if (ctx.currentNoteName) {
        return `Read ${ctx.currentNoteName} and continue writing from where it ends. Match the tone and structure already established.`
      }
      return "Continue writing from where the note ends. Match the tone and structure already established."
    },
  },
  {
    name: "outline",
    label: "Outline",
    hint: "Outline the topic of the note",
    build: (ctx) => {
      if (ctx.currentNoteName) {
        return `Produce a hierarchical outline of ${ctx.currentNoteName}.`
      }
      return "Produce a hierarchical outline of the open note."
    },
  },
  {
    name: "translate",
    label: "Translate",
    hint: "Translate the selection to another language",
    build: () => "Translate the selected text into English. Preserve markdown structure.",
  },
  {
    name: "critique",
    label: "Critique",
    hint: "Critique the writing in this note",
    build: (ctx) => {
      if (ctx.hasSelection) return "Critique the selected text. Focus on clarity, structure, and concrete suggestions."
      if (ctx.currentNoteName) {
        return `Critique ${ctx.currentNoteName}. Focus on clarity, structure, and concrete suggestions.`
      }
      return "Critique the open note. Focus on clarity, structure, and concrete suggestions."
    },
  },
]

/**
 * If the composer's text is currently a slash trigger (e.g. `/sum`), return
 * the partial query for matching commands. Returns null when no trigger is
 * active. The trigger is intentionally strict — only at the very start of
 * the input and only while no whitespace has been typed yet — to avoid
 * surprising the user mid-sentence.
 */
export function detectSlashTrigger(text: string): string | null {
  if (!text.startsWith("/")) return null
  const rest = text.slice(1)
  if (/\s/.test(rest)) return null
  return rest
}

export function matchSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase()
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter((c) =>
    c.name.startsWith(q) || c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q),
  )
}
