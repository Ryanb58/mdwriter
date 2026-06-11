import { useMemo } from "react"
import { FileText } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { useVaultNotes } from "../../lib/vaultNotes"

const MAX_RECENT = 5

export function RecentFiles() {
  const notes = useVaultNotes()
  const selectedPath = useStore((s) => s.selectedPath)
  const setSelected = useStore((s) => s.setSelected)

  // Most-recently-modified notes, same recency source the file palette uses
  // (tree mtime). The currently-open file is excluded — it's already front
  // of mind.
  const recent = useMemo(
    () =>
      notes
        .filter((n) => n.path !== selectedPath)
        .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
        .slice(0, MAX_RECENT),
    [notes, selectedPath],
  )

  if (recent.length < 2) return null

  return (
    <section className="border-b border-border px-1.5 pb-1.5">
      <div className="px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide text-text-subtle">
        Recent
      </div>
      <div className="space-y-0.5">
        {recent.map((note) => (
          <div
            key={note.path}
            className="flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[13px] transition-colors cursor-pointer text-text-muted hover:bg-elevated hover:text-text"
            title={note.rel}
            onClick={() => setSelected(note.path)}
          >
            <FileText size={13} weight="regular" className="flex-none text-text-subtle" />
            <span className="min-w-0 flex-1 truncate">{note.name}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
