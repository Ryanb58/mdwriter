import { useEffect, useState } from "react"
import { X } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"

type Props = {
  chatId: string
  onClose: () => void
}

/**
 * Modal for editing a chat's per-thread system prompt. Saved into the
 * active `Chat.systemPrompt`; `buildPrompt` prepends it on every turn.
 */
export function SystemPromptModal({ chatId, onClose }: Props) {
  const chat = useStore((s) => s.chats[chatId])
  const setChatSystemPrompt = useStore((s) => s.setChatSystemPrompt)
  const [draft, setDraft] = useState(chat?.systemPrompt ?? "")

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  if (!chat) return null

  const save = () => {
    setChatSystemPrompt(chatId, draft.trim())
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-[1px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[min(560px,90vw)] flex flex-col rounded-lg border border-border-strong bg-surface shadow-2xl">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <span className="text-[12px] font-medium text-text">Chat instructions</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X size={11} weight="bold" />
          </button>
        </header>
        <div className="px-4 py-3">
          <p className="text-[11px] text-text-subtle mb-2">
            Sent on every turn before your message. Useful for setting a tone,
            persona, or constraints that should hold for this whole thread.
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Respond in the style of a careful, terse technical editor."
            rows={8}
            className="w-full rounded-md border border-border bg-elevated px-2.5 py-2 text-[13px] leading-relaxed font-mono placeholder:text-text-subtle focus:border-accent transition-colors"
            autoFocus
          />
        </div>
        <div className="border-t border-border px-4 py-2.5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-md text-[12px] text-text-muted hover:text-text hover:bg-elevated"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="px-3 py-1 rounded-md text-[12px] bg-accent text-accent-fg hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
