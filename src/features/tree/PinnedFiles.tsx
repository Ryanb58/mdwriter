import { FileText, PushPinSimpleSlash } from "@phosphor-icons/react"
import { basename, isMarkdown, relativeTo } from "../../lib/paths"
import { useStore } from "../../lib/store"
import { revealPath } from "./treeLoader"

function displayName(path: string): string {
  return basename(path).replace(/\.(md|markdown)$/i, "")
}

export function PinnedFiles() {
  const rootPath = useStore((s) => s.rootPath)
  const pinnedPaths = useStore((s) => s.pinnedPaths)
  const selectedPath = useStore((s) => s.selectedPath)
  const setSelected = useStore((s) => s.setSelected)
  const unpinPath = useStore((s) => s.unpinPath)
  const pins = pinnedPaths.filter(isMarkdown)

  if (pins.length === 0) return null

  return (
    <section className="border-b border-border px-1.5 pb-1.5">
      <div className="px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide text-text-subtle">
        Pinned
      </div>
      <div className="space-y-0.5">
        {pins.map((path) => {
          const active = selectedPath === path
          const rel = rootPath ? relativeTo(rootPath, path) : path
          return (
            <div
              key={path}
              className={[
                "group flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[13px] transition-colors",
                "cursor-pointer",
                active
                  ? "bg-accent-soft text-text"
                  : "text-text-muted hover:bg-elevated hover:text-text",
              ].join(" ")}
              title={rel}
              onClick={() => {
                setSelected(path)
                void revealPath(path)
              }}
            >
              <FileText size={13} weight="regular" className="flex-none text-text-subtle" />
              <span className={`min-w-0 flex-1 truncate ${active ? "font-medium" : ""}`}>
                {displayName(path)}
              </span>
              <button
                type="button"
                className="flex-none rounded p-0.5 text-text-subtle opacity-70 transition-colors hover:bg-elevated hover:text-text group-hover:opacity-100"
                title="Unpin"
                aria-label={`Unpin ${displayName(path)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  unpinPath(path)
                }}
              >
                <PushPinSimpleSlash size={12} />
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
