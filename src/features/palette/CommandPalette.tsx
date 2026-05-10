import { useEffect, useState, useMemo } from "react"
import { Command } from "cmdk"
import { MagnifyingGlass, FileText } from "@phosphor-icons/react"
import type { TreeNode } from "../../lib/ipc"
import { useStore } from "../../lib/store"

function flattenFiles(node: TreeNode | null, rootPath: string | null): { name: string; path: string; rel: string }[] {
  if (!node) return []
  if (node.kind === "file") {
    const rel = rootPath && node.path.startsWith(rootPath)
      ? node.path.slice(rootPath.length).replace(/^[\\/]+/, "")
      : node.path
    return [{ name: node.name, path: node.path, rel }]
  }
  return node.children.flatMap((c) => flattenFiles(c, rootPath))
}

function stripExt(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "")
}

export function CommandPalette() {
  const tree = useStore((s) => s.tree)
  const rootPath = useStore((s) => s.rootPath)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const files = useMemo(() => flattenFiles(tree, rootPath), [tree, rootPath])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === "p") {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === "Escape" && open) setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] bg-black/40 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <Command
        className="w-[520px] max-w-[90vw] rounded-xl bg-elevated border border-border-strong overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: "0 24px 48px -12px oklch(0 0 0 / 0.6), 0 4px 8px oklch(0 0 0 / 0.3)" }}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
          <MagnifyingGlass size={14} className="text-text-subtle flex-none" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Open file…"
            className="flex-1 outline-none text-[14px] placeholder:text-text-subtle"
          />
          <kbd className="text-[10px] font-mono text-text-subtle border border-border rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <Command.List className="max-h-[360px] overflow-y-auto py-1.5">
          <Command.Empty className="px-4 py-6 text-[12px] text-text-subtle text-center">
            No matching files.
          </Command.Empty>
          {files.map((f) => {
            const display = stripExt(f.name)
            const folder = f.rel.replace(/[\\/]?[^\\/]+$/, "")
            return (
              <Command.Item
                key={f.path}
                value={`${f.rel} ${f.name}`}
                onSelect={() => {
                  useStore.setState({ selectedPath: f.path })
                  setOpen(false)
                }}
                className="mx-1.5 px-2.5 py-1.5 rounded-md text-[13px] flex items-center gap-2.5 cursor-pointer aria-selected:bg-accent-soft aria-selected:text-text text-text-muted"
              >
                <FileText size={13} className="flex-none text-text-subtle" />
                <span className="truncate">{display}</span>
                {folder && (
                  <span className="ml-auto text-[11px] text-text-subtle font-mono truncate">{folder}</span>
                )}
              </Command.Item>
            )
          })}
        </Command.List>
      </Command>
    </div>
  )
}
