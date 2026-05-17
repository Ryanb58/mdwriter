import { useState } from "react"
import { SlidersHorizontal, ShieldCheck, ShieldWarning, Eye } from "@phosphor-icons/react"
import { useStore, permissionModeLabel } from "../../lib/store"
import type { PermissionMode } from "../../lib/ipc"
import { ChatList } from "./ChatList"
import { ChatView } from "./ChatView"
import { MessageInput } from "./MessageInput"
import { SystemPromptModal } from "./SystemPromptModal"

export function AiPanel() {
  const activeChatId = useStore((s) => s.activeChatId)
  const systemPrompt = useStore((s) => (activeChatId ? s.chats[activeChatId]?.systemPrompt : null))
  const [editingInstructions, setEditingInstructions] = useState(false)

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
        <ChatList />
        <UsageMeter />
        <PermissionModeButton />
        {activeChatId && (
          <button
            onClick={() => setEditingInstructions(true)}
            className={`flex-none p-1 rounded transition-colors ${
              systemPrompt
                ? "text-accent hover:bg-elevated"
                : "text-text-subtle hover:text-text hover:bg-elevated"
            }`}
            title={systemPrompt ? "Edit chat instructions" : "Add chat instructions"}
            aria-label="Edit chat instructions"
          >
            <SlidersHorizontal size={12} />
          </button>
        )}
      </header>
      <ChatView />
      <MessageInput />
      {editingInstructions && activeChatId && (
        <SystemPromptModal
          chatId={activeChatId}
          onClose={() => setEditingInstructions(false)}
        />
      )}
    </div>
  )
}

function UsageMeter() {
  const usage = useStore((s) => (s.activeChatId ? s.chats[s.activeChatId]?.usage : null))
  if (!usage) return null
  const total = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens
  if (total === 0) return null
  return (
    <span
      className="text-[10px] tabular-nums text-text-subtle flex-none px-1"
      title={`Input ${usage.inputTokens.toLocaleString()} · Output ${usage.outputTokens.toLocaleString()} · Cache read ${usage.cacheReadTokens.toLocaleString()} · Cache write ${usage.cacheCreationTokens.toLocaleString()}`}
    >
      {formatTokens(total)}
    </span>
  )
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n} tok`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k tok`
  return `${(n / 1_000_000).toFixed(1)}m tok`
}

/**
 * Cycle button for the agent's permission posture. Click rotates through
 * accept-edits → bypass-permissions → plan. Icon and tint change with the
 * mode so the current posture is glanceable.
 */
function PermissionModeButton() {
  const mode = useStore((s) => s.aiPermissionMode)
  const cycle = useStore((s) => s.cycleAiPermissionMode)
  const { Icon, tone } = modePresentation(mode)
  return (
    <button
      onClick={cycle}
      className={`flex-none flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-[0.08em] font-medium transition-colors ${tone}`}
      title={`Permission mode: ${permissionModeLabel(mode)} — click to cycle`}
      aria-label={`Permission mode: ${permissionModeLabel(mode)}. Click to cycle.`}
    >
      <Icon size={11} weight="bold" />
      <span>{shortLabel(mode)}</span>
    </button>
  )
}

function modePresentation(mode: PermissionMode) {
  switch (mode) {
    case "accept-edits":
      return {
        Icon: ShieldCheck,
        tone: "text-text-subtle hover:text-text hover:bg-elevated",
      }
    case "bypass-permissions":
      return {
        Icon: ShieldWarning,
        tone: "text-warning hover:bg-elevated",
      }
    case "plan":
      return {
        Icon: Eye,
        tone: "text-accent hover:bg-elevated",
      }
  }
}

function shortLabel(mode: PermissionMode): string {
  switch (mode) {
    case "accept-edits":
      return "Edits"
    case "bypass-permissions":
      return "Bypass"
    case "plan":
      return "Plan"
  }
}
