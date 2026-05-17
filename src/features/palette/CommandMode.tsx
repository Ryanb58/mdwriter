import { useEffect, useMemo, useRef, useState } from "react"
import { Command } from "cmdk"
import { Lightning } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { ipc, type Skill, type SkillSource } from "../../lib/ipc"
import { openPanel } from "../../layout/layoutControl"
import { scoreSkillMatch } from "./scoreSkill"

/**
 * Cmd+Shift+P palette mode. Lists every SKILL.md found across the four
 * canonical skill directories (vault `.claude`, vault `.agents`, user-home
 * variants) and dispatches the chosen one into the AI composer as a skill
 * pill. The agent reads the SKILL.md at run time — we never inline its body.
 */
export function CommandMode({
  initialQuery,
  onQueryChange,
  close,
}: {
  initialQuery: string
  onQueryChange: (q: string) => void
  close: () => void
}) {
  const rootPath = useStore((s) => s.rootPath)
  const setRightPaneTab = useStore((s) => s.setRightPaneTab)
  const requestSkillInsert = useStore((s) => s.requestAiSkillInsert)
  const [skills, setSkills] = useState<Skill[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // When the query changes, cmdk re-ranks and re-selects the first match —
  // but the list keeps its prior scroll position. Reset to top so the user
  // always sees the top-ranked results they're typing toward.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [initialQuery])

  useEffect(() => {
    let cancelled = false
    ipc
      .listSkills(rootPath)
      .then((rows) => {
        if (!cancelled) setSkills(rows)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [rootPath])

  const sorted = useMemo(() => {
    if (!skills) return []
    // cmdk re-ranks on query; alphabetize for the empty-query view.
    return [...skills].sort((a, b) => a.name.localeCompare(b.name))
  }, [skills])

  function pick(skill: Skill) {
    setRightPaneTab("ai")
    openPanel("right")
    requestSkillInsert(skill.name)
    close()
  }

  return (
    <Command
      loop
      filter={scoreSkillMatch}
      onKeyDown={handleTabAsArrow}
      className="rounded-xl bg-elevated border border-border-strong overflow-hidden"
      style={{
        boxShadow:
          "0 24px 48px -12px oklch(0 0 0 / 0.6), 0 4px 8px oklch(0 0 0 / 0.3)",
      }}
    >
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
        <Lightning size={14} className="text-accent flex-none" weight="fill" />
        <Command.Input
          autoFocus
          value={initialQuery}
          onValueChange={onQueryChange}
          placeholder="Run a skill…"
          className="flex-1 outline-none text-[14px] placeholder:text-text-subtle"
        />
        <kbd className="text-[10px] font-mono text-text-subtle border border-border rounded px-1.5 py-0.5">
          esc
        </kbd>
      </div>
      <Command.List
        ref={listRef}
        className="max-h-[360px] overflow-y-auto py-1.5"
      >
        {error ? (
          <div className="px-4 py-6 text-[12px] text-danger text-center">
            Failed to load skills: {error}
          </div>
        ) : skills == null ? (
          <div className="px-4 py-6 text-[12px] text-text-subtle text-center">
            Loading skills…
          </div>
        ) : sorted.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-text-subtle text-center">
            No skills found. Add a <code className="font-mono">SKILL.md</code> to{" "}
            <code className="font-mono">.claude/skills/&lt;name&gt;/</code> or{" "}
            <code className="font-mono">.agents/skills/&lt;name&gt;/</code>.
          </div>
        ) : (
          <>
            <Command.Empty className="px-4 py-6 text-[12px] text-text-subtle text-center">
              No matching skills.
            </Command.Empty>
            {sorted.map((skill) => (
              <Command.Item
                key={`${skill.source}:${skill.absPath}`}
                // Value = name + source so duplicate names from different
                // sources stay individually selectable (cmdk keys selection
                // state by value). Description goes into keywords so the
                // custom scorer can weight name matches above description
                // matches.
                value={`${skill.name}__${skill.source}`}
                keywords={[skill.description, skill.source]}
                onSelect={() => pick(skill)}
                className="mx-1.5 px-2.5 py-1.5 rounded-md text-[13px] flex items-center gap-2.5 cursor-pointer aria-selected:bg-accent-soft aria-selected:text-text text-text-muted"
              >
                <Lightning size={13} className="flex-none text-text-subtle" />
                <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
                  {/* whitespace-nowrap prevents long hyphenated names like
                      `/competitor-profiling` from breaking onto a second line,
                      which would make row heights uneven and break cmdk's
                      scroll-into-view on selection change. */}
                  <span className="font-mono text-[12px] text-text whitespace-nowrap flex-none">
                    /{skill.name}
                  </span>
                  {skill.description && (
                    <span className="text-[11px] text-text-subtle truncate min-w-0">
                      {skill.description}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-text-subtle font-mono flex-none ml-2 uppercase tracking-[0.1em] whitespace-nowrap">
                  {sourceLabel(skill.source)}
                </span>
              </Command.Item>
            ))}
          </>
        )}
      </Command.List>
    </Command>
  )
}

/**
 * cmdk binds ArrowDown/ArrowUp for navigation but leaves Tab/Shift+Tab as
 * default browser tab-focus. Users coming from VS Code's Cmd+Shift+P expect
 * Tab to cycle entries, so we intercept it and synthesize an arrow keydown
 * that cmdk's own handler picks up via React's event delegation.
 *
 * Dispatched on `currentTarget` (the root `<Command>` div) where cmdk's
 * native listener lives.
 */
function handleTabAsArrow(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "Tab") return
  e.preventDefault()
  const key = e.shiftKey ? "ArrowUp" : "ArrowDown"
  e.currentTarget.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true }),
  )
}

function sourceLabel(source: SkillSource): string {
  switch (source) {
    case "vault-claude":
      return "vault · claude"
    case "vault-agents":
      return "vault · agents"
    case "user-claude":
      return "user · claude"
    case "user-agents":
      return "user · agents"
  }
}
