import { useState } from "react"
import { Plus, SlidersHorizontal, Trash } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { AgentPicker } from "./AgentPicker"
import { ChatList } from "./ChatList"
import { ChatView } from "./ChatView"
import { MessageInput } from "./MessageInput"
import { SystemPromptModal } from "./SystemPromptModal"

export function AiPanel() {
  const messages = useStore((s) => s.aiMessages)
  const activeChatId = useStore((s) => s.activeChatId)
  const createChat = useStore((s) => s.createChat)
  const deleteChat = useStore((s) => s.deleteChat)
  const systemPrompt = useStore((s) => (activeChatId ? s.chats[activeChatId]?.systemPrompt : null))
  const [editingInstructions, setEditingInstructions] = useState(false)

  function onClearOrDelete() {
    if (!activeChatId) return
    if (messages.length === 0) {
      deleteChat(activeChatId)
    } else {
      deleteChat(activeChatId)
    }
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <ChatList />
          <AgentPicker variant="compact" />
        </div>
        <div className="flex items-center gap-1 flex-none">
          <UsageMeter />
          {activeChatId && (
            <button
              onClick={() => setEditingInstructions(true)}
              className={`p-1 rounded transition-colors ${
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
          <button
            onClick={() => createChat({ activate: true })}
            className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated transition-colors"
            title="New chat"
            aria-label="New chat"
          >
            <Plus size={12} weight="bold" />
          </button>
          <button
            onClick={onClearOrDelete}
            disabled={!activeChatId}
            className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Delete chat"
            aria-label="Delete chat"
          >
            <Trash size={12} />
          </button>
        </div>
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
      className="text-[10px] tabular-nums text-text-subtle px-1.5"
      title={`Input ${usage.inputTokens.toLocaleString()} · Output ${usage.outputTokens.toLocaleString()} · Cache read ${usage.cacheReadTokens.toLocaleString()} · Cache write ${usage.cacheCreationTokens.toLocaleString()}`}
    >
      {formatTokens(total)} tok
    </span>
  )
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}m`
}
