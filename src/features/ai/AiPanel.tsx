import { Trash } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { useAiSession } from "./useAiSession"
import { AgentPicker } from "./AgentPicker"
import { ChatView } from "./ChatView"
import { MessageInput } from "./MessageInput"

export function AiPanel() {
  useAiSession()
  const messages = useStore((s) => s.aiMessages)
  const clearAiMessages = useStore((s) => s.clearAiMessages)

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <AgentPicker />
        <button
          onClick={clearAiMessages}
          disabled={messages.length === 0}
          className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Clear conversation"
          aria-label="Clear conversation"
        >
          <Trash size={12} />
        </button>
      </header>
      <ChatView />
      <MessageInput />
    </div>
  )
}
