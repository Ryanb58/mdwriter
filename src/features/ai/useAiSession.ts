import { useEffect } from "react"
import { listen } from "@tauri-apps/api/event"
import { ipc, type AiStreamEvent } from "../../lib/ipc"
import { useStore } from "../../lib/store"
import { buildPrompt } from "./buildPrompt"

/**
 * Detect installed agents on mount and listen for the streaming events that
 * Rust emits while a session is alive. Each event mutates the latest assistant
 * message in the store so the UI re-renders.
 */
export function useAiSession() {
  useEffect(() => {
    let cancelled = false
    ipc.detectAgents().then((rows) => {
      if (cancelled) return
      useStore.getState().setAiAvailable(rows)
      // If the persisted agent isn't available, pick the first that is.
      const cur = useStore.getState().aiAgent
      const curRow = rows.find((r) => r.id === cur)
      if (!curRow?.available) {
        const firstAvail = rows.find((r) => r.available && r.implemented)
        if (firstAvail) useStore.getState().setAiAgent(firstAvail.id)
      }
    }).catch(console.error)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const unlisten = listen<AiStreamEvent>("ai-stream", (e) => {
      const ev = e.payload
      const store = useStore.getState()
      switch (ev.kind) {
        case "text":
          store.patchLastAssistantMessage((m) => ({ ...m, text: m.text + ev.text }))
          break
        case "tool-start":
          store.patchLastAssistantMessage((m) => ({
            ...m,
            tools: [...m.tools, {
              id: ev.id,
              name: ev.name,
              input: ev.input,
              output: null,
              isError: false,
              finished: false,
            }],
          }))
          break
        case "tool-result":
          store.patchLastAssistantMessage((m) => ({
            ...m,
            tools: m.tools.map((t) =>
              t.id === ev.id
                ? { ...t, output: ev.output, isError: ev.isError, finished: true }
                : t,
            ),
          }))
          break
        case "error":
          store.patchLastAssistantMessage((m) => ({
            ...m,
            text: m.text + (m.text ? "\n\n" : "") + `**Error:** ${ev.message}`,
          }))
          break
        case "done":
          store.patchLastAssistantMessage((m) => ({ ...m, finished: true }))
          store.setAiRunning(false)
          break
      }
    })
    return () => { unlisten.then((u) => u()) }
  }, [])
}

export async function sendPrompt(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  const store = useStore.getState()
  if (store.aiRunning) return
  const root = store.rootPath
  if (!root) return

  store.appendAiMessage({ role: "user", text: trimmed })
  store.appendAiMessage({ role: "assistant", text: "", tools: [], finished: false })
  store.setAiRunning(true)

  // The user sees their raw prompt in history, but the agent gets a wrapped
  // version with the currently-open note and wikilink hints.
  const currentNote = relForCurrentNote(store.openDoc?.path ?? store.selectedPath ?? null, root)
  const wrapped = buildPrompt({ currentNote, userText: trimmed })

  try {
    await ipc.startAiSession(store.aiAgent, wrapped, root)
  } catch (e) {
    store.patchLastAssistantMessage((m) => ({
      ...m,
      text: `**Error:** ${String(e)}`,
      finished: true,
    }))
    store.setAiRunning(false)
  }
}

export async function cancelSession() {
  await ipc.stopAiSession().catch(console.error)
  useStore.getState().setAiRunning(false)
}

function relForCurrentNote(absPath: string | null, root: string | null): string | null {
  if (!absPath || !root) return null
  if (!absPath.startsWith(root)) return null
  return absPath.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/")
}
