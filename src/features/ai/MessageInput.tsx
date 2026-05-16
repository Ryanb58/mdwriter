import { useEffect, useRef, useState } from "react"
import { ArrowUp, Stop, TextAa, X } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { useVaultNotes, type VaultNote } from "../../lib/vaultNotes"
import { sendPrompt, cancelSession } from "./useAiSession"
import {
  applyWikilinkSelection,
  detectMentionTrigger,
  type WikilinkTrigger,
} from "./wikilinkDetect"
import { WikilinkPopover, useWikilinkResults } from "./WikilinkPopover"

export function MessageInput() {
  const [draft, setDraft] = useState("")
  const [trigger, setTrigger] = useState<WikilinkTrigger | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const running = useStore((s) => s.aiRunning)
  const draftRequest = useStore((s) => s.aiDraftRequest)
  const consumeAiDraftRequest = useStore((s) => s.consumeAiDraftRequest)
  const notes = useVaultNotes()
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Honor externally-injected drafts ("Edit and resend"). The nonce is
  // captured in the effect dep so back-to-back requests with the same text
  // still re-seed the input.
  useEffect(() => {
    if (!draftRequest) return
    setDraft(draftRequest.text)
    consumeAiDraftRequest()
    requestAnimationFrame(() => {
      const el = taRef.current
      if (!el) return
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    })
  }, [draftRequest, consumeAiDraftRequest])

  // Auto-grow textarea up to a sensible max.
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 220) + "px"
  }, [draft])

  // Reset highlight when the query changes so a new search starts at the top.
  useEffect(() => {
    setActiveIdx(0)
  }, [trigger?.query])

  // Recompute the trigger from the current caret position. `[[` and `@` both
  // open the picker; the chosen note is inserted as `[[name]]` either way.
  function syncTrigger(value: string, caret: number) {
    setTrigger(detectMentionTrigger(value, caret))
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setDraft(value)
    syncTrigger(value, e.target.selectionStart ?? value.length)
  }

  // The textarea's caret can move without `value` changing (arrow keys, click).
  function onSelect(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget
    syncTrigger(el.value, el.selectionStart ?? el.value.length)
  }

  const results = useWikilinkResults(notes, trigger?.query ?? "")

  function selectNote(note: VaultNote) {
    if (!trigger) return
    const { value, caret } = applyWikilinkSelection(draft, trigger, note.name)
    setDraft(value)
    setTrigger(null)
    // Restore caret after React renders the new value.
    requestAnimationFrame(() => {
      const el = taRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  function submit() {
    if (running) return
    const t = draft.trim()
    if (!t) return
    sendPrompt(t)
    setDraft("")
    setTrigger(null)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Popover is open: arrows/Enter/Esc operate on it.
    if (trigger) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIdx((i) => (results.length === 0 ? 0 : (i + 1) % results.length))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIdx((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length))
        return
      }
      if (e.key === "Enter" && !e.shiftKey) {
        if (results.length > 0) {
          e.preventDefault()
          selectNote(results[Math.min(activeIdx, results.length - 1)])
          return
        }
      }
      if (e.key === "Tab" && results.length > 0) {
        e.preventDefault()
        selectNote(results[Math.min(activeIdx, results.length - 1)])
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setTrigger(null)
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-border p-2.5">
      <SelectionChip />
      <div className="relative rounded-md border border-border bg-elevated focus-within:border-accent transition-colors">
        <textarea
          ref={taRef}
          value={draft}
          onChange={onChange}
          onSelect={onSelect}
          onKeyDown={onKeyDown}
          onBlur={() => setTrigger(null)}
          rows={1}
          placeholder="Ask the agent…  type @ or [[ to reference a note"
          className="w-full resize-none bg-transparent text-[13px] leading-relaxed px-2.5 py-2 pr-10 placeholder:text-text-subtle"
          style={{ maxHeight: 220 }}
        />
        {trigger && (
          <WikilinkPopover
            notes={notes}
            query={trigger.query}
            activeIndex={activeIdx}
            onHover={setActiveIdx}
            onSelect={selectNote}
          />
        )}
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
        <kbd className="font-mono">Enter</kbd> to send · <kbd className="font-mono">Shift+Enter</kbd> for newline · <kbd className="font-mono">@</kbd> or <kbd className="font-mono">[[</kbd> to reference
      </div>
    </div>
  )
}

/**
 * Floats above the textarea when the user has text selected in either editor
 * mode. The chip's X marks the selection as detached (`attached: false`); the
 * next non-empty selection re-attaches automatically.
 */
function SelectionChip() {
  const selection = useStore((s) => s.editorSelection)
  const detach = useStore((s) => s.detachEditorSelection)
  if (!selection || !selection.text || !selection.attached) return null

  const lineCount = selection.text.split("\n").length
  const charCount = selection.text.length
  const preview = selection.text.length > 80
    ? selection.text.slice(0, 80).replace(/\s+/g, " ") + "…"
    : selection.text.replace(/\s+/g, " ")
  const summary = lineCount > 1 ? `${lineCount} lines` : `${charCount} chars`
  const sourceLabel = selection.sourcePath
    ? selection.sourcePath.split(/[\\/]/).pop() ?? "selection"
    : "selection"

  return (
    <div className="mb-1.5 flex items-start gap-1.5 rounded-md border border-border bg-elevated px-2 py-1.5 text-[11px]">
      <TextAa size={11} className="text-text-subtle flex-none mt-[2px]" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-text-muted">
          <span className="font-medium text-text">{sourceLabel}</span>
          <span className="text-text-subtle">· {summary}</span>
        </div>
        <div className="text-text-subtle truncate font-mono text-[11px]">{preview}</div>
      </div>
      <button
        type="button"
        onClick={detach}
        className="p-1 -m-1 rounded text-text-subtle hover:text-text hover:bg-surface flex-none"
        title="Don't include selection"
        aria-label="Don't include selection"
      >
        <X size={10} weight="bold" />
      </button>
    </div>
  )
}
