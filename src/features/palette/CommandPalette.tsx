import { useEffect, useState, useMemo } from "react"
import { Command } from "cmdk"
import type { TreeNode } from "../../lib/ipc"
import { useStore } from "../../lib/store"

function flattenFiles(node: TreeNode | null): { name: string; path: string }[] {
  if (!node) return []
  if (node.kind === "file") return [{ name: node.name, path: node.path }]
  return node.children.flatMap(flattenFiles)
}

export function CommandPalette() {
  const tree = useStore((s) => s.tree)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const files = useMemo(() => flattenFiles(tree), [tree])

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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/40" onClick={() => setOpen(false)}>
      <Command
        className="w-[480px] rounded-lg bg-neutral-900 border border-neutral-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Open file…"
          className="w-full px-3 py-2 bg-neutral-900 border-b border-neutral-700 outline-none text-sm"
        />
        <Command.List className="max-h-72 overflow-auto">
          <Command.Empty className="px-3 py-2 text-xs opacity-50">No results.</Command.Empty>
          {files.map((f) => (
            <Command.Item
              key={f.path}
              value={f.path}
              onSelect={() => {
                useStore.setState({ selectedPath: f.path })
                setOpen(false)
              }}
              className="px-3 py-1.5 text-sm aria-selected:bg-blue-600 aria-selected:text-white"
            >
              <div className="truncate">{f.name}</div>
              <div className="text-[10px] opacity-50 truncate">{f.path}</div>
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  )
}
