import { Trash } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { AgentPicker } from "./AgentPicker"
import { ChatView } from "./ChatView"
import { MessageInput } from "./MessageInput"

export function AiPanel() {
  const messages = useStore((s) => s.aiMessages)
  const clearAiMessages = useStore((s) => s.clearAiMessages)

  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] uppercase tracking-[0.14em] text-text-subtle">Assistant</span>
          <AgentPicker variant="compact" />
        </div>
        <div className="flex items-center gap-1">
          {/* Token / usage slot — populated in Phase 4. Slot is reserved so
              header height doesn't shift when usage starts streaming. */}
          <span
            id="ai-usage-slot"
            className="text-[10px] tabular-nums text-text-subtle empty:hidden"
          />
          <button
            onClick={clearAiMessages}
            disabled={messages.length === 0}
            className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Clear conversation"
            aria-label="Clear conversation"
          >
            <Trash size={12} />
          </button>
        </div>
      </header>
      <ChatView />
      <MessageInput />
    </div>
  )
}
