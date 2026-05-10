import { useEffect, useRef, useState } from "react"
import { ArrowUp, Stop } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { sendPrompt, cancelSession } from "./useAiSession"

export function MessageInput() {
  const [draft, setDraft] = useState("")
  const running = useStore((s) => s.aiRunning)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow textarea up to a sensible max.
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 220) + "px"
  }, [draft])

  function submit() {
    if (running) return
    const t = draft.trim()
    if (!t) return
    sendPrompt(t)
    setDraft("")
  }

  return (
    <div className="border-t border-border p-2.5">
      <div className="relative rounded-md border border-border bg-elevated focus-within:border-accent transition-colors">
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder="Ask the agent…"
          className="w-full resize-none bg-transparent text-[13px] leading-relaxed px-2.5 py-2 pr-10 placeholder:text-text-subtle"
          style={{ maxHeight: 220 }}
        />
        <div className="absolute right-1.5 bottom-1.5">
          {running ? (
            <button
              onClick={cancelSession}
              className="p-1.5 rounded-md bg-danger/15 text-danger hover:bg-danger/25 transition-colors"
              title="Stop"
              aria-label="Stop"
            >
              <Stop size={12} weight="fill" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!draft.trim()}
              className="p-1.5 rounded-md bg-accent text-accent-fg disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              title="Send (Enter)"
              aria-label="Send"
            >
              <ArrowUp size={12} weight="bold" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 px-1 text-[10px] text-text-subtle">
        <kbd className="font-mono">Enter</kbd> to send · <kbd className="font-mono">Shift+Enter</kbd> for newline
      </div>
    </div>
  )
}
