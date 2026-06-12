import { useMemo } from "react"
import { FileText } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { basename } from "../../lib/paths"
import { findNode } from "./findNode"

const MAX_RECENT = 5

/**
 * Files recently *opened in the app* for this vault — newest first, from the
 * store's recency list (maintained by setOpenDoc, persisted). Deliberately
 * not disk-mtime: files touched by git/sync/other tools shouldn't surface as
 * "recent" when the user never opened them here.
 */
export function RecentFiles() {
  const tree = useStore((s) => s.tree)
  const rootPath = useStore((s) => s.rootPath)
  const recentByVault = useStore((s) => s.recentFilesByVault)
  const selectedPath = useStore((s) => s.selectedPath)
  const setSelected = useStore((s) => s.setSelected)

  const recent = useMemo(() => {
    const list = rootPath ? recentByVault[rootPath] ?? [] : []
    return list
      // The open file is already front of mind; deleted/renamed files drop out.
      .filter((p) => p !== selectedPath && findNode(tree, p))
      .slice(0, MAX_RECENT)
      .map((path) => ({
        path,
        name: basename(path).replace(/\.(md|markdown)$/i, ""),
        rel: rootPath && path.startsWith(rootPath)
          ? path.slice(rootPath.length).replace(/^[\\/]+/, "")
          : path,
      }))
  }, [recentByVault, rootPath, selectedPath, tree])

  if (recent.length === 0) return null

  return (
    <section className="border-b border-border px-1.5 pb-1.5">
      <div className="px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide text-text-subtle">
        Recent
      </div>
      <div className="space-y-0.5">
        {recent.map((note) => (
          <button
            type="button"
            key={note.path}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-[3px] text-[13px] transition-colors cursor-pointer text-text-muted hover:bg-elevated hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            title={note.rel}
            onClick={() => setSelected(note.path)}
          >
            <FileText size={13} weight="regular" className="flex-none text-text-subtle" />
            <span className="min-w-0 flex-1 truncate text-left">{note.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
