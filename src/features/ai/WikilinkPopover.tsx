import { useEffect, useMemo, useRef } from "react"
import { FileText } from "@phosphor-icons/react"
import type { VaultNote } from "../../lib/vaultNotes"

type Props = {
  notes: VaultNote[]
  query: string
  activeIndex: number
  onHover: (i: number) => void
  onSelect: (note: VaultNote) => void
  /** Where the popover sits relative to its anchor. Default: above. */
  placement?: "above" | "below"
}

const MAX_RESULTS = 8

/**
 * Tiny case-insensitive substring filter. We don't need cmdk's full fuzzy
 * matching for an in-input picker — substring is predictable and fast.
 *
 * With no query, the list is the most-recently-modified notes first (the
 * typical "I want to reference what I was just working on" case). With a
 * query, results sort by match quality and break ties by recency.
 */
function filterNotes(notes: VaultNote[], query: string): VaultNote[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return notes.slice().sort(byMtimeDesc).slice(0, MAX_RESULTS)
  }
  const out: { note: VaultNote; score: number }[] = []
  for (const n of notes) {
    const name = n.name.toLowerCase()
    const rel = n.rel.toLowerCase()
    const nameIdx = name.indexOf(q)
    const relIdx = rel.indexOf(q)
    if (nameIdx < 0 && relIdx < 0) continue
    // Prefer name matches, then matches near the start.
    const score = nameIdx >= 0 ? nameIdx : 1000 + relIdx
    out.push({ note: n, score })
  }
  out.sort((a, b) => a.score - b.score || byMtimeDesc(a.note, b.note))
  return out.slice(0, MAX_RESULTS).map((x) => x.note)
}

function byMtimeDesc(a: VaultNote, b: VaultNote): number {
  // Notes without an mtime (rare — only happens when the FS read failed)
  // sink to the bottom so well-known files always win.
  return (b.mtime ?? 0) - (a.mtime ?? 0)
}

export function useWikilinkResults(notes: VaultNote[], query: string): VaultNote[] {
  return useMemo(() => filterNotes(notes, query), [notes, query])
}

export function WikilinkPopover({
  notes,
  query,
  activeIndex,
  onHover,
  onSelect,
  placement = "above",
}: Props) {
  const results = useWikilinkResults(notes, query)
  const listRef = useRef<HTMLDivElement>(null)
  const anchorClass = placement === "above" ? "bottom-full mb-1" : "top-full mt-1"

  // Keep the active item in view as the caret moves.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-idx="${activeIndex}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, results.length])

  if (results.length === 0) {
    return (
      <div
        className={`absolute left-0 ${anchorClass} w-full max-w-[360px] rounded-md bg-elevated border border-border-strong px-3 py-2 text-[12px] text-text-subtle z-30`}
        style={{ boxShadow: "0 12px 32px -8px oklch(0 0 0 / 0.55), 0 2px 4px oklch(0 0 0 / 0.3)" }}
      >
        No matching notes.
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className={`absolute left-0 ${anchorClass} w-full max-w-[360px] rounded-md bg-elevated border border-border-strong overflow-y-auto z-30`}
      style={{
        maxHeight: 240,
        boxShadow: "0 12px 32px -8px oklch(0 0 0 / 0.55), 0 2px 4px oklch(0 0 0 / 0.3)",
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle px-3 pt-2 pb-1">
        Reference a note
      </div>
      {results.map((n, i) => {
        const folder = n.rel.replace(/[\\/]?[^\\/]+$/, "")
        return (
          <button
            key={n.path}
            type="button"
            data-idx={i}
            onMouseDown={(e) => {
              e.preventDefault() // keep focus on the textarea
              onSelect(n)
            }}
            onMouseEnter={() => onHover(i)}
            className={[
              "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px]",
              i === activeIndex
                ? "bg-accent-soft text-text"
                : "text-text-muted hover:bg-surface",
            ].join(" ")}
          >
            <FileText size={12} className="flex-none text-text-subtle" />
            <span className="truncate">{n.name}</span>
            {folder && (
              <span className="ml-auto text-[11px] text-text-subtle font-mono truncate">{folder}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export const __test__ = { filterNotes }
