import { useEffect, useRef } from "react"
import { useStore, type AssistantMessage } from "../../lib/store"
import { basename } from "../../lib/paths"
import { MarkdownView } from "./MarkdownView"
import { MessageActions } from "./MessageActions"
import { ToolActionCard } from "./ToolActionCard"
import { sendPrompt } from "./useAiSession"

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <EmptyState />
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

/**
 * Empty-state surface for a fresh chat. Suggests prompts the agent can act
 * on immediately: if a note is open, the suggestions reference it; otherwise
 * they're vault-wide.
 */
function EmptyState() {
  const openDocPath = useStore((s) => s.openDoc?.path ?? null)
  const noteName = openDocPath ? basename(openDocPath) : null
  const suggestions = noteName
    ? [
        { label: `Summarise ${noteName}`, prompt: `Summarise ${noteName} in 3–5 bullet points.` },
        { label: "Continue writing", prompt: `Read ${noteName} and continue writing from where it ends.` },
        { label: "Find related notes", prompt: `Find notes in this vault related to ${noteName}.` },
        { label: "Outline this note", prompt: `Produce a hierarchical outline of ${noteName}.` },
      ]
    : [
        { label: "Find recent notes", prompt: "List the 5 notes I've edited most recently in this vault." },
        { label: "Look for orphans", prompt: "Find notes in this vault that no other note links to." },
        { label: "What's in this vault?", prompt: "Give me an overview of what this vault contains by topic." },
      ]

  return (
    <div className="px-4 pt-6 pb-4">
      <p className="text-[12px] text-text-subtle mb-3">
        Ask the agent. It runs from your vault root and can read, edit, and
        create notes.
      </p>
      <div className="space-y-1.5">
        {suggestions.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => sendPrompt(s.prompt)}
            className="w-full text-left px-2.5 py-2 rounded-md border border-border bg-surface hover:bg-elevated hover:border-border-strong transition-colors group"
          >
            <div className="text-[12.5px] text-text">{s.label}</div>
            <div className="text-[11px] text-text-subtle truncate">{s.prompt}</div>
          </button>
        ))}
      </div>
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
        <ToolActionCard key={t.id} tool={t} messageIdx={idx} />
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
