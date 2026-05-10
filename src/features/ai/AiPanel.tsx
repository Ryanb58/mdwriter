import { Trash, X } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { useAiSession } from "./useAiSession"
import { AgentPicker } from "./AgentPicker"
import { ChatView } from "./ChatView"
import { MessageInput } from "./MessageInput"

export function AiPanel() {
  useAiSession()
  const messages = useStore((s) => s.aiMessages)
  const clearAiMessages = useStore((s) => s.clearAiMessages)
  const setAiPanelVisible = useStore((s) => s.setAiPanelVisible)

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <AgentPicker />
        <div className="flex items-center gap-0.5">
          <button
            onClick={clearAiMessages}
            disabled={messages.length === 0}
            className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Clear conversation"
            aria-label="Clear conversation"
          >
            <Trash size={12} />
          </button>
          <button
            onClick={() => setAiPanelVisible(false)}
            className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated transition-colors"
            title="Close AI panel"
            aria-label="Close AI panel"
          >
            <X size={12} weight="bold" />
          </button>
        </div>
      </header>
      <ChatView />
      <MessageInput />
    </div>
  )
}
