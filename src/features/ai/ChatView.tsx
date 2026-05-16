import { useEffect, useRef } from "react"
import { useStore, type AssistantMessage } from "../../lib/store"
import { MarkdownView } from "./MarkdownView"
import { MessageActions } from "./MessageActions"
import { ToolActionCard } from "./ToolActionCard"

export function ChatView() {
  const messages = useStore((s) => s.aiMessages)
  const running = useStore((s) => s.aiRunning)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new content unless user has scrolled up.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages, running])

  if (messages.length === 0) {
    return (
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 text-center text-text-subtle text-[12px]">
        Ask the agent something. It runs from your vault root and can read,
        edit, and create notes.
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
      {messages.map((msg, i) => {
        if (msg.role === "user") {
          return (
            <div key={i} className="group text-[13px]">
              <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle mb-1">You</div>
              <div className="text-text whitespace-pre-wrap break-words">{msg.text}</div>
              <MessageActions messageIdx={i} message={msg} />
            </div>
          )
        }
        if (msg.role === "system") {
          return (
            <div key={i} className="text-[12px] text-text-subtle italic">
              {msg.text}
            </div>
          )
        }
        return <AssistantBlock key={i} idx={i} msg={msg} isLast={i === messages.length - 1} running={running} />
      })}
    </div>
  )
}

function AssistantBlock({
  idx, msg, isLast, running,
}: {
  idx: number
  msg: AssistantMessage
  isLast: boolean
  running: boolean
}) {
  const showSpinner = isLast && running && !msg.finished && msg.text === "" && msg.tools.length === 0
  return (
    <div className="group text-[13px]">
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle mb-1">Assistant</div>
      {msg.tools.map((t) => (
        <ToolActionCard key={t.id} tool={t} />
      ))}
      {showSpinner && (
        <div className="text-text-subtle text-[12px]">Thinking…</div>
      )}
      {msg.text && <MarkdownView text={msg.text} />}
      {/* Only show actions once the message has *something* — copy of an empty
          message isn't useful, and regenerate while streaming is unsafe. */}
      {(msg.finished || msg.text.length > 0) && (
        <MessageActions messageIdx={idx} message={msg} />
      )}
    </div>
  )
}
