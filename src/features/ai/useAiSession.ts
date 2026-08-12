import { useEffect } from "react"
import {
  agentBusyDetail,
  ipc,
  type AgentBusyDetail,
  type AiStreamEvent,
  type AiPermissionRequest,
} from "../../lib/ipc"
import { useStore, type AssistantMessage } from "../../lib/store"
import { listenForThisWindow } from "../../lib/windowEvents"
import { buildPrompt, extractSkillRefs } from "./buildPrompt"

/**
 * Detect installed agents on mount and listen for the streaming events that
 * Rust emits while a session is alive. Each event mutates the latest assistant
 * message in the store so the UI re-renders.
 *
 * Both subscriptions are window-scoped. Rust addresses `ai-stream` and
 * `ai-permission` at the window that owns the session (`emit_to`), and a bare
 * `listen()` would undo that: it registers `EventTarget::Any`, which Tauri
 * delivers to regardless of the emit target. Another window would then render
 * this session's tokens — and, worse, its approval cards. See
 * `src/lib/windowEvents.ts`.
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
    const unlisten = listenForThisWindow<AiStreamEvent>("ai-stream", (e) => {
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
        case "done": {
          const turn = parseUsage(ev.usage)
          if (turn) store.addChatUsage(turn)
          store.patchLastAssistantMessage((m) => ({ ...m, finished: true }))
          store.setAiRunning(false)
          store.clearPendingPermissions()
          break
        }
      }
    })
    return () => { unlisten.then((u) => u()) }
  }, [])

  useEffect(() => {
    const unlisten = listenForThisWindow<AiPermissionRequest>("ai-permission", (e) => {
      useStore.getState().addPendingPermission(e.payload)
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
  // version with the currently-open note, wikilink hints, and any text
  // explicitly attached as a selection chip in the composer.
  const currentNote = relForCurrentNote(store.openDoc?.path ?? store.selectedPath ?? null, root)
  const sel = store.editorSelection
  const selection = sel && sel.attached && sel.text
    ? { text: sel.text, sourceNote: relForCurrentNote(sel.sourcePath, root) }
    : null
  const activeChat = store.activeChatId ? store.chats[store.activeChatId] : null
  const systemPrompt = activeChat?.systemPrompt ?? null
  // Only fetch the skill registry when the prompt actually invokes one.
  // The list is small but the IPC roundtrip on every send adds up.
  const needsSkills = extractSkillRefs(trimmed).length > 0
  const availableSkills = needsSkills
    ? await ipc.listSkills(root).catch((e) => {
        console.error("[ai] listSkills failed:", e)
        return null
      })
    : null
  const wrapped = buildPrompt({
    currentNote,
    userText: trimmed,
    selection,
    systemPrompt,
    availableSkills,
  })

  try {
    await ipc.startAiSession(store.aiAgent, wrapped, root, store.aiPermissionMode)
    // The lock was free after all (or is ours) — drop any stale busy notice.
    store.setAiBusy(null)
  } catch (e) {
    // One agent subprocess exists process-wide. Another window holding it is a
    // normal, recoverable state, not an error: name the vault and let the panel
    // offer to focus that window.
    const busy = agentBusyDetail(e)
    if (busy) store.setAiBusy(busy)
    store.patchLastAssistantMessage((m) => ({
      ...m,
      text: busy ? agentBusyMessage(busy) : `**Error:** ${String(e)}`,
      finished: true,
    }))
    store.setAiRunning(false)
  }
}

/** Chat-transcript wording for a refused start. */
export function agentBusyMessage(busy: AgentBusyDetail): string {
  const where = busy.ownerVault ? ` in **${vaultName(busy.ownerVault)}**` : ""
  return `**Agent busy** — another window${where} is running the agent. Only one agent session runs at a time.`
}

/** Last path segment of a vault root, for display. */
export function vaultName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export async function cancelSession() {
  await ipc.stopAiSession().catch(console.error)
  const store = useStore.getState()
  store.setAiRunning(false)
  store.clearPendingPermissions()
  // Finalize the half-streamed assistant turn (mirrors the `done` handler)
  // so it stops rendering as in-flight and Regenerate's message indexing
  // stays sound.
  const msgs = store.aiMessages
  const idx = msgs.findLastIndex((m) => m.role === "assistant")
  if (idx < 0) return
  const last = msgs[idx] as AssistantMessage
  if (last.finished) return
  if (!last.text && last.tools.length === 0) {
    // Nothing streamed before the stop — drop the empty placeholder turn.
    store.setAiMessages([...msgs.slice(0, idx), ...msgs.slice(idx + 1)])
    return
  }
  store.patchLastAssistantMessage((m) => ({
    ...m,
    finished: true,
    tools: m.tools.map((t) =>
      t.finished ? t : { ...t, finished: true, isError: t.output == null || t.isError },
    ),
  }))
}

/**
 * Trim history back to (but excluding) `messageIdx`, then re-run the user turn
 * that preceded it. Used by "Regenerate" on assistant messages.
 */
export async function regenerateFrom(messageIdx: number) {
  const store = useStore.getState()
  if (store.aiRunning) return
  const msgs = store.aiMessages
  const target = msgs[messageIdx]
  if (!target || target.role !== "assistant") return
  // Find the most recent user message before this assistant message.
  let userIdx = -1
  for (let i = messageIdx - 1; i >= 0; i--) {
    if (msgs[i].role === "user") { userIdx = i; break }
  }
  if (userIdx === -1) return
  const userText = (msgs[userIdx] as { text: string }).text
  // Trim back to *before* the user turn so `sendPrompt`'s append doesn't
  // produce a duplicate user message in the history — it'll re-add both
  // the user turn and the new assistant turn from scratch.
  store.setAiMessages(msgs.slice(0, userIdx))
  await sendPrompt(userText)
}

/**
 * Drop everything from `userMessageIdx` onward and seed the composer with
 * that user's text via `aiDraftRequest`. Used by "Edit and resend".
 */
export function editAndResetFrom(userMessageIdx: number) {
  const store = useStore.getState()
  if (store.aiRunning) return
  const msgs = store.aiMessages
  const target = msgs[userMessageIdx]
  if (!target || target.role !== "user") return
  store.setAiMessages(msgs.slice(0, userMessageIdx))
  store.requestAiDraft(target.text)
}

/**
 * Trim the assistant message at `assistantIdx` and everything after it.
 * Used by "Branch from here" — the prior user turn becomes the trailing
 * context; the composer is left empty for the user to type a new direction.
 */
export function branchFrom(assistantIdx: number) {
  const store = useStore.getState()
  if (store.aiRunning) return
  const msgs = store.aiMessages
  const target = msgs[assistantIdx]
  if (!target || target.role !== "assistant") return
  store.setAiMessages(msgs.slice(0, assistantIdx))
}

function relForCurrentNote(absPath: string | null, root: string | null): string | null {
  if (!absPath || !root) return null
  if (!absPath.startsWith(root)) return null
  return absPath.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/")
}

/**
 * Pull token counts out of an opaque `usage` payload emitted by an agent
 * adapter. Returns null when nothing token-shaped is present (e.g. the
 * subprocess waiter's `{ exit_code }` Done that fires after Claude Code's
 * own usage Done).
 *
 * Handles both Claude Code's snake_case fields and any future agent that
 * emits camelCase.
 */
function parseUsage(usage: unknown): {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
} | null {
  if (!usage || typeof usage !== "object") return null
  const u = usage as Record<string, unknown>
  const num = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = u[k]
      if (typeof v === "number" && Number.isFinite(v)) return v
    }
    return undefined
  }
  const input = num("input_tokens", "inputTokens")
  const output = num("output_tokens", "outputTokens")
  const cacheRead = num("cache_read_input_tokens", "cacheReadTokens")
  const cacheCreate = num("cache_creation_input_tokens", "cacheCreationTokens")
  if (input == null && output == null && cacheRead == null && cacheCreate == null) return null
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreate,
  }
}
