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
          {/* Token / usage slot — populated in Phase 4. */}
          <span
            id="ai-usage-slot"
            className="text-[10px] tabular-nums text-text-subtle empty:hidden"
          />
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
