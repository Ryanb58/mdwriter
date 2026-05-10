import { useEffect, useRef, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { CaretUpDown, FolderOpen, Plus, Folder, Check } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { ipc } from "../../lib/ipc"
import { openFolder } from "../folder/useFolderPicker"
import { basename, joinPath } from "../../lib/paths"

const MAX_RECENTS = 5

export function VaultPicker() {
  const rootPath = useStore((s) => s.rootPath)
  const recents = useStore((s) => s.recentFolders)
  const setRoot = useStore((s) => s.setRoot)
  const setTree = useStore((s) => s.setTree)
  const setRecent = useStore((s) => s.setRecent)

  const [open_, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState("")
  const wrapRef = useRef<HTMLDivElement>(null)

  // Other recents = excludes current vault, capped
  const otherRecents = recents.filter((p) => p !== rootPath).slice(0, MAX_RECENTS)

  useEffect(() => {
    if (!open_) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
        setDraftName("")
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false); setCreating(false); setDraftName("")
      }
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open_])

  async function switchTo(path: string) {
    setOpen(false)
    try {
      await openFolder(path, { setRoot, setTree, setRecent })
    } catch (e) {
      console.error("failed to open", path, e)
    }
  }

  async function openLocalFolder() {
    setOpen(false)
    const selected = await open({ directory: true, multiple: false })
    if (!selected || typeof selected !== "string") return
    await openFolder(selected, { setRoot, setTree, setRecent })
  }

  async function commitCreate() {
    const name = draftName.trim()
    if (!name) { setCreating(false); setDraftName(""); return }
    // Pick the parent location
    const parent = await open({ directory: true, multiple: false, title: `Pick a location for "${name}"` })
    if (!parent || typeof parent !== "string") {
      setCreating(false); setDraftName("")
      return
    }
    const path = joinPath(parent, name)
    try {
      await ipc.createDir(path)
      setOpen(false)
      setCreating(false)
      setDraftName("")
      await openFolder(path, { setRoot, setTree, setRecent })
    } catch (e) {
      console.error("failed to create vault", e)
      // Surface a tiny inline error — leaving the dropdown open
      alert(`Couldn't create "${name}" at ${parent}: ${String(e)}`)
    }
  }

  const currentName = rootPath ? basename(rootPath) : "—"

  return (
    <div ref={wrapRef} className="relative border-t border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className={[
          "w-full flex items-center gap-2 px-3 py-2.5 text-[13px] transition-colors",
          open_ ? "bg-elevated text-text" : "text-text hover:bg-elevated",
        ].join(" ")}
      >
        <Folder size={14} weight="duotone" className="text-text-subtle flex-none" />
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle leading-none mb-0.5">Vault</div>
          <div className="truncate font-medium">{currentName}</div>
        </div>
        <CaretUpDown size={12} className="text-text-subtle flex-none" />
      </button>

      {open_ && (
        <div
          className="absolute left-2 right-2 bottom-[calc(100%+6px)] rounded-lg bg-elevated border border-border-strong overflow-hidden text-[13px]"
          style={{ boxShadow: "0 12px 32px -8px oklch(0 0 0 / 0.55), 0 2px 4px oklch(0 0 0 / 0.3)" }}
        >
          {!creating && (
            <>
              {/* Current vault — pinned at top */}
              {rootPath && (
                <div className="px-2 pt-2 pb-1">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle px-2 mb-1">Open</div>
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-accent-soft text-text">
                    <Check size={12} weight="bold" className="text-text-subtle flex-none" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{currentName}</div>
                      <div className="text-[11px] text-text-subtle font-mono truncate">{rootPath}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Recents */}
              {otherRecents.length > 0 && (
                <div className="px-2 pt-1 pb-1">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle px-2 mb-1">Recent</div>
                  <ul>
                    {otherRecents.map((p) => (
                      <li key={p}>
                        <button
                          onClick={() => switchTo(p)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-text-muted hover:bg-surface hover:text-text"
                        >
                          <Folder size={12} weight="duotone" className="text-text-subtle flex-none" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{basename(p)}</div>
                            <div className="text-[11px] text-text-subtle font-mono truncate">{p}</div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-border" />

              {/* Actions */}
              <div className="p-1.5">
                <button
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-text-muted hover:bg-surface hover:text-text"
                >
                  <Plus size={12} weight="bold" className="flex-none" />
                  Create Empty Vault
                </button>
                <button
                  onClick={openLocalFolder}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-text-muted hover:bg-surface hover:text-text"
                >
                  <FolderOpen size={12} weight="regular" className="flex-none" />
                  Open Local Folder
                </button>
              </div>
            </>
          )}

          {creating && (
            <div className="p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle mb-2">New Vault</div>
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitCreate()
                  if (e.key === "Escape") { setCreating(false); setDraftName("") }
                }}
                placeholder="Vault name"
                className="w-full bg-surface border border-border rounded-md px-2 py-1.5 text-[13px] placeholder:text-text-subtle focus:outline-none focus:border-accent"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={commitCreate}
                  disabled={!draftName.trim()}
                  className="flex-1 px-2 py-1.5 rounded-md bg-accent text-accent-fg text-[12px] font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                >
                  Choose location…
                </button>
                <button
                  onClick={() => { setCreating(false); setDraftName("") }}
                  className="px-2 py-1.5 rounded-md text-[12px] text-text-muted hover:text-text"
                >
                  Cancel
                </button>
              </div>
              <div className="text-[11px] text-text-subtle mt-2">
                You'll pick a parent folder; mdwriter creates "{draftName.trim() || "name"}" inside it.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
