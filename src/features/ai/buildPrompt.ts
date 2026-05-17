import type { Skill } from "../../lib/ipc"

/**
 * Wrap a user's prompt with vault context so the agent knows (a) which note
 * the user is looking at, (b) what `[[wikilinks]]` mean in this vault, and
 * (c) which skills were invoked so it can load their SKILL.md instructions.
 *
 * Kept pure for tests. The agent's working directory is already the vault
 * root, so wikilinks resolve to `<vault>/<name>.md` and vault-relative skill
 * paths resolve from there too.
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
  /** Currently discoverable skills. Used to resolve `[[skill:name]]` refs to
   *  their on-disk SKILL.md paths so the agent can read them at run time. */
  availableSkills?: Skill[] | null
}

/** Find every plain `[[name]]` reference (note links). Skill refs of the
 *  form `[[skill:name]]` are deliberately excluded — they're handled by
 *  `extractSkillRefs`. Returned names are in order and deduped. */
export function extractWikilinks(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\[\[([^\]\n[]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const inner = m[1].trim()
    if (!inner || inner.startsWith("skill:")) continue
    if (seen.has(inner)) continue
    seen.add(inner)
    out.push(inner)
  }
  return out
}

/** Find every `[[skill:name]]` reference in the prompt, in order, deduped. */
export function extractSkillRefs(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\[\[skill:([^\]\n[]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** Resolve a skill name against the available-skills registry. Returns the
 *  best on-disk path the agent can read — vault-relative when possible,
 *  absolute for user-level skills. */
function resolveSkillPath(name: string, skills: Skill[] | null | undefined): string | null {
  if (!skills) return null
  const skill = skills.find((s) => s.name === name)
  if (!skill) return null
  return skill.vaultRelPath ?? skill.absPath
}

export function buildPrompt(ctx: PromptContext): string {
  const lines: string[] = []
  const refs = extractWikilinks(ctx.userText)
  const skillRefs = extractSkillRefs(ctx.userText)
  const sel = ctx.selection && ctx.selection.text ? ctx.selection : null
  const systemPrompt = ctx.systemPrompt?.trim() || null

  if (systemPrompt) {
    lines.push("[chat instructions]")
    lines.push(systemPrompt)
    lines.push("[/chat instructions]")
    lines.push("")
  }

  if (ctx.currentNote || refs.length > 0 || skillRefs.length > 0 || sel) {
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
    if (skillRefs.length > 0) {
      lines.push(
        "The user invoked these skills — read each SKILL.md and follow its instructions:",
      )
      for (const name of skillRefs) {
        const path = resolveSkillPath(name, ctx.availableSkills)
        if (path) {
          lines.push(`- ${name} → ${path}`)
        } else {
          lines.push(`- ${name} → (unresolved — no SKILL.md found for this name)`)
        }
      }
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
