/**
 * Wrap a user's prompt with vault context so the agent knows (a) which note
 * the user is looking at and (b) what `[[wikilinks]]` mean in this vault.
 *
 * Kept pure for tests. The agent's working directory is already the vault
 * root, so wikilinks resolve to `<vault>/<name>.md`.
 */
export type PromptContext = {
  /** Vault-root-relative path of the note open in the editor, if any. */
  currentNote: string | null
  /** User's raw prompt as typed. */
  userText: string
}

/** Find every `[[name]]` reference in the prompt, in order, deduped. */
export function extractWikilinks(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\[\[([^\]\n[]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function buildPrompt(ctx: PromptContext): string {
  const lines: string[] = []
  const refs = extractWikilinks(ctx.userText)

  if (ctx.currentNote || refs.length > 0) {
    lines.push("[mdwriter context]")
    if (ctx.currentNote) {
      lines.push(`The user is currently viewing: ${ctx.currentNote}`)
    }
    if (refs.length > 0) {
      lines.push(
        `The user referenced these notes with [[wikilinks]] — read them as ${refs
          .map((r) => `\`${r}.md\``)
          .join(", ")} from the vault root.`,
      )
    }
    lines.push("[/mdwriter context]")
    lines.push("")
  }

  lines.push(ctx.userText)
  return lines.join("\n")
}
