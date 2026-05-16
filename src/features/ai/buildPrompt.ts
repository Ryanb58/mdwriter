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
  /** Highlighted text the user attached as additional context. */
  selection?: { text: string; sourceNote: string | null } | null
  /** Per-thread system prompt the user authored in the chat's Instructions. */
  systemPrompt?: string | null
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
  const sel = ctx.selection && ctx.selection.text ? ctx.selection : null
  const systemPrompt = ctx.systemPrompt?.trim() || null

  if (systemPrompt) {
    lines.push("[chat instructions]")
    lines.push(systemPrompt)
    lines.push("[/chat instructions]")
    lines.push("")
  }

  if (ctx.currentNote || refs.length > 0 || sel) {
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
    if (sel) {
      const from = sel.sourceNote ? ` (from ${sel.sourceNote})` : ""
      lines.push(`The user has highlighted the following text${from} as additional context:`)
      lines.push("<selection>")
      lines.push(sel.text)
      lines.push("</selection>")
    }
    lines.push("[/mdwriter context]")
    lines.push("")
  }

  lines.push(ctx.userText)
  return lines.join("\n")
}
