import { useState } from "react"
import { SlidersHorizontal } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
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
