import { useState } from "react"
import { ArrowsSplit, Check, Copy, NotePencil, Repeat } from "@phosphor-icons/react"
import { useStore, type AiMessage } from "../../lib/store"
import { branchFrom, editAndResetFrom, regenerateFrom } from "./useAiSession"

type Props = {
  messageIdx: number
  message: AiMessage
}

/**
 * Hover-revealed action row attached to a message. The set of actions is
 * role-dependent:
 *   - user:      Copy · Edit & resend
 *   - assistant: Copy · Regenerate · Branch from here
 * Disabled while a session is streaming so the user can't fork mid-turn.
 */
export function MessageActions({ messageIdx, message }: Props) {
  const running = useStore((s) => s.aiRunning)
  const [copied, setCopied] = useState(false)

  const text = messageText(message)

  const onCopy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
      // Don't let action clicks bubble into selection/scroll handlers below.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ActionButton
        title={copied ? "Copied" : "Copy"}
        onClick={onCopy}
        disabled={!text}
        icon={copied ? <Check size={11} weight="bold" /> : <Copy size={11} />}
      />
      {message.role === "user" && (
        <ActionButton
          title="Edit and resend"
          onClick={() => editAndResetFrom(messageIdx)}
          disabled={running}
          icon={<NotePencil size={11} />}
        />
      )}
      {message.role === "assistant" && (
        <>
          <ActionButton
            title="Regenerate"
            onClick={() => regenerateFrom(messageIdx)}
            disabled={running}
            icon={<Repeat size={11} />}
          />
          <ActionButton
            title="Branch from here"
            onClick={() => branchFrom(messageIdx)}
            disabled={running}
            icon={<ArrowsSplit size={11} />}
          />
        </>
      )}
    </div>
  )
}

function ActionButton({
  icon, title, onClick, disabled,
}: {
  icon: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {icon}
    </button>
  )
}

function messageText(m: AiMessage): string {
  if (m.role === "user" || m.role === "system") return m.text
  return m.text
}
