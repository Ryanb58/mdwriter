import { useEffect, useRef } from "react"
import { ipc } from "../../lib/ipc"
import { useStore, type Chat } from "../../lib/store"

const WRITE_DEBOUNCE_MS = 400

/**
 * Mirror the in-memory `chats` map to `<vault>/.mdwriter/chats/`. The hook
 * does two things:
 *
 * 1. **Hydrate on vault change** — when `rootPath` becomes non-null, list
 *    chat summaries from disk and read each chat fully. The most recent
 *    chat becomes active so the user picks up where they left off.
 * 2. **Persist on chat change** — each chat that mutates is written back as
 *    an atomic JSON file, debounced per-chat so a streaming assistant turn
 *    doesn't hammer the disk.
 *
 * Errors are logged and otherwise tolerated — losing one chat is better than
 * stalling the UI.
 */
export function useChatPersistence() {
  const rootPath = useStore((s) => s.rootPath)
  // Snapshots so the unsubscribe effect can read the last-written state
  // without re-subscribing on every chat mutation.
  const previousRoot = useRef<string | null>(null)
  const lastWrittenJson = useRef<Map<string, string>>(new Map())
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Hydrate when vault changes.
  useEffect(() => {
    if (previousRoot.current === rootPath) return
    previousRoot.current = rootPath
    // Cancel any pending writes from the prior vault — they target a path
    // that's no longer relevant.
    for (const t of pendingTimers.current.values()) clearTimeout(t)
    pendingTimers.current.clear()
    lastWrittenJson.current.clear()

    if (!rootPath) {
      useStore.getState().setChats({})
      useStore.getState().setActiveChat(null)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const summaries = await ipc.listChats(rootPath)
        const chats: Record<string, Chat> = {}
        await Promise.all(
          summaries.map(async (s) => {
            try {
              const raw = await ipc.readChat(rootPath, s.id)
              const chat = normalizeChat(raw)
              if (chat) chats[chat.id] = chat
            } catch (e) {
              console.error("[chats] read failed", s.id, e)
            }
          }),
        )
        if (cancelled) return
        useStore.getState().setChats(chats)
        // Pre-fill `lastWrittenJson` so the persist effect doesn't immediately
        // rewrite every loaded chat back to disk.
        for (const chat of Object.values(chats)) {
          lastWrittenJson.current.set(chat.id, JSON.stringify(chat))
        }
      } catch (e) {
        console.error("[chats] list failed", e)
      }
    })()
    return () => { cancelled = true }
  }, [rootPath])

  // Persist on chat change.
  useEffect(() => {
    const unsubscribe = useStore.subscribe((s, prev) => {
      const root = s.rootPath
      if (!root) return
      if (s.chats === prev.chats) return
      // Diff chats: write new/changed, delete dropped.
      const oldChats = prev.chats
      const newChats = s.chats
      // Detect deletes.
      for (const id of Object.keys(oldChats)) {
        if (!newChats[id]) {
          const t = pendingTimers.current.get(id)
          if (t) clearTimeout(t)
          pendingTimers.current.delete(id)
          lastWrittenJson.current.delete(id)
          ipc.deleteChat(root, id).catch((e) => console.error("[chats] delete failed", id, e))
        }
      }
      // Detect creates / updates.
      for (const id of Object.keys(newChats)) {
        const chat = newChats[id]
        const json = JSON.stringify(chat)
        if (lastWrittenJson.current.get(id) === json) continue
        const existingTimer = pendingTimers.current.get(id)
        if (existingTimer) clearTimeout(existingTimer)
        const timer = setTimeout(() => {
          pendingTimers.current.delete(id)
          lastWrittenJson.current.set(id, json)
          ipc.writeChat(root, id, chat).catch((e) =>
            console.error("[chats] write failed", id, e),
          )
        }, WRITE_DEBOUNCE_MS)
        pendingTimers.current.set(id, timer)
      }
    })
    return () => {
      unsubscribe()
      // Flush any pending writes on unmount.
      const root = useStore.getState().rootPath
      if (!root) return
      for (const [id, timer] of pendingTimers.current.entries()) {
        clearTimeout(timer)
        const chat = useStore.getState().chats[id]
        if (chat) ipc.writeChat(root, id, chat).catch(() => undefined)
      }
      pendingTimers.current.clear()
    }
  }, [])
}

/**
 * Coerce a raw JSON payload from disk into a `Chat`. Returns null when the
 * payload is too malformed to recover (missing id or messages array) — those
 * chats are silently skipped during hydration.
 */
function normalizeChat(raw: unknown): Chat | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const id = typeof obj.id === "string" ? obj.id : null
  if (!id) return null
  const messages = Array.isArray(obj.messages) ? (obj.messages as Chat["messages"]) : null
  if (!messages) return null
  const now = Date.now()
  return {
    id,
    title: typeof obj.title === "string" ? obj.title : "",
    agent: (obj.agent as Chat["agent"]) ?? "claude-code",
    messages,
    systemPrompt: typeof obj.systemPrompt === "string" ? obj.systemPrompt : "",
    createdAt: typeof obj.createdAt === "number" ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : now,
  }
}
