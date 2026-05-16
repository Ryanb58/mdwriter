import { useEffect, useMemo, useRef, useState } from "react"
import { CaretDown, ChatCircle, Plus, Trash } from "@phosphor-icons/react"
import { useStore, type Chat } from "../../lib/store"

/**
 * Dropdown header that lists this vault's chats. The active chat's title is
 * the trigger label; clicking opens a menu with all other threads sorted by
 * recency, a "New chat" button, and per-row delete.
 */
export function ChatList() {
  const chats = useStore((s) => s.chats)
  const activeChatId = useStore((s) => s.activeChatId)
  const setActiveChat = useStore((s) => s.setActiveChat)
  const createChat = useStore((s) => s.createChat)
  const deleteChat = useStore((s) => s.deleteChat)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const sorted = useMemo(() => sortChats(chats), [chats])
  const active = activeChatId ? chats[activeChatId] : null
  const label = active ? chatLabel(active) : "New chat"

  function onCreate() {
    createChat({ activate: true })
    setOpen(false)
  }

  function onOpen(id: string) {
    setActiveChat(id)
    setOpen(false)
  }

  function onDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    deleteChat(id)
  }

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] min-w-0 transition-colors ${
          open ? "bg-elevated text-text" : "text-text-muted hover:text-text hover:bg-elevated"
        }`}
        title="Chats in this vault"
      >
        <ChatCircle size={11} className="text-text-subtle flex-none" />
        <span className="truncate flex-1 text-left">{label}</span>
        <CaretDown size={9} className="text-text-subtle flex-none" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-[calc(100%+4px)] z-[100] w-[280px] rounded-lg bg-elevated border border-border-strong overflow-hidden"
          style={{ boxShadow: "0 12px 32px -8px oklch(0 0 0 / 0.55), 0 2px 4px oklch(0 0 0 / 0.3)" }}
        >
          <button
            type="button"
            onClick={onCreate}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-text hover:bg-surface text-left"
          >
            <Plus size={12} weight="bold" className="text-text-subtle" />
            New chat
          </button>
          {sorted.length > 0 && (
            <div className="border-t border-border max-h-[320px] overflow-y-auto py-1">
              {sorted.map((chat) => {
                const isActive = chat.id === activeChatId
                return (
                  <div
                    key={chat.id}
                    className={`group flex items-center gap-2 px-3 py-1.5 text-[12px] cursor-pointer ${
                      isActive
                        ? "bg-accent-soft text-text"
                        : "text-text-muted hover:text-text hover:bg-surface"
                    }`}
                    onClick={() => onOpen(chat.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{chatLabel(chat)}</div>
                      <div className="text-[10px] text-text-subtle">{relativeTime(chat.updatedAt)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => onDelete(chat.id, e)}
                      className="p-1 rounded text-text-subtle hover:text-danger hover:bg-bg opacity-0 group-hover:opacity-100 transition-opacity flex-none"
                      title="Delete chat"
                      aria-label="Delete chat"
                    >
                      <Trash size={11} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function sortChats(chats: Record<string, Chat>): Chat[] {
  return Object.values(chats).sort((a, b) => b.updatedAt - a.updatedAt)
}

function chatLabel(chat: Chat): string {
  return chat.title || "New chat"
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return "just now"
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`
  if (diff < day) return `${Math.floor(diff / hour)}h ago`
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`
  return new Date(ts).toLocaleDateString()
}
