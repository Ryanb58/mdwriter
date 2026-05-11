import { Trash } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { ChatView } from "./ChatView"
import { MessageInput } from "./MessageInput"

export function AiPanel() {
  const messages = useStore((s) => s.aiMessages)
  const clearAiMessages = useStore((s) => s.clearAiMessages)

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <span className="text-[11px] uppercase tracking-[0.14em] text-text-subtle">Assistant</span>
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
