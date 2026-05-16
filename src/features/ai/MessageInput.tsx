import { useEffect, useRef, useState, useMemo } from "react"
import { ArrowUp, Stop, TextAa, X, Lightning } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { useVaultNotes, type VaultNote } from "../../lib/vaultNotes"
import { sendPrompt, cancelSession } from "./useAiSession"
import {
  applyWikilinkSelection,
  detectMentionTrigger,
  type WikilinkTrigger,
} from "./wikilinkDetect"
import { WikilinkPopover, useWikilinkResults } from "./WikilinkPopover"
import { basename, joinPath } from "../../lib/paths"
import { ipc } from "../../lib/ipc"
import { readClipboardImageAsPng } from "../../lib/imagePaste"
import { detectSlashTrigger, matchSlashCommands, type SlashCommand } from "./slashCommands"

export function MessageInput() {
  const [draft, setDraft] = useState("")
  const [trigger, setTrigger] = useState<WikilinkTrigger | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [slashActiveIdx, setSlashActiveIdx] = useState(0)
  const running = useStore((s) => s.aiRunning)
  const draftRequest = useStore((s) => s.aiDraftRequest)
  const consumeAiDraftRequest = useStore((s) => s.consumeAiDraftRequest)
  const openDocPath = useStore((s) => s.openDoc?.path ?? null)
  const hasSelection = useStore((s) => !!s.editorSelection?.text)
  const notes = useVaultNotes()
  const taRef = useRef<HTMLTextAreaElement>(null)

  const slashQuery = useMemo(() => detectSlashTrigger(draft), [draft])
  const slashMatches = useMemo(
    () => (slashQuery == null ? [] : matchSlashCommands(slashQuery)),
    [slashQuery],
  )

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

  useEffect(() => {
    setSlashActiveIdx(0)
  }, [slashQuery])

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

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const cd = e.clipboardData
    if (!cd) return
    // Fast path: a real image item is present (Chromium-style clipboards).
    for (const item of Array.from(cd.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile()
        if (!file) continue
        e.preventDefault()
        const bytes = new Uint8Array(await file.arrayBuffer())
        const mime = file.type || "image/png"
        attachImage(bytes, mime, taRef.current, setDraft)
        return
      }
    }
    // WKWebView fallback: clipboard reports types=["Files"] with empty items.
    // Same workaround the editor uses — read native RGBA and re-encode as PNG.
    if (cd.items.length === 0 && cd.files.length === 0 && Array.from(cd.types).includes("Files")) {
      e.preventDefault()
      try {
        const bytes = await readClipboardImageAsPng()
        if (bytes) attachImage(bytes, "image/png", taRef.current, setDraft)
      } catch (err) {
        console.error("[chat image paste] failed:", err)
      }
    }
  }

  function applySlash(cmd: SlashCommand) {
    const ctx = {
      currentNoteName: openDocPath ? basename(openDocPath) : null,
      hasSelection,
    }
    const next = cmd.build(ctx)
    setDraft(next)
    setSlashActiveIdx(0)
    requestAnimationFrame(() => {
      const el = taRef.current
      if (!el) return
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Slash command popover takes precedence over the mention picker when both
    // could theoretically open — in practice `/` at the start can't co-occur
    // with a wikilink trigger.
    if (slashQuery != null && slashMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSlashActiveIdx((i) => (i + 1) % slashMatches.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSlashActiveIdx((i) => (i - 1 + slashMatches.length) % slashMatches.length)
        return
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault()
        applySlash(slashMatches[Math.min(slashActiveIdx, slashMatches.length - 1)])
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setDraft("")
        return
      }
    }

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
    <div className="border-t border-border p-2.5" data-mdwriter-ai-composer>
      <SelectionChip />
      <div className="relative rounded-md border border-border bg-elevated focus-within:border-accent transition-colors">
        <textarea
          ref={taRef}
          value={draft}
          onChange={onChange}
          onSelect={onSelect}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          onBlur={() => setTrigger(null)}
          rows={1}
          placeholder="Ask the agent…  type @ or [[ to reference a note · paste images"
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
        {slashQuery != null && slashMatches.length > 0 && !trigger && (
          <SlashPopover
            matches={slashMatches}
            activeIndex={slashActiveIdx}
            onHover={setSlashActiveIdx}
            onPick={applySlash}
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
        <kbd className="font-mono">Enter</kbd> · <kbd className="font-mono">Shift+Enter</kbd> newline · <kbd className="font-mono">@</kbd>/<kbd className="font-mono">[[</kbd> reference · <kbd className="font-mono">/</kbd> commands · <kbd className="font-mono">⌘L</kbd> focus
      </div>
    </div>
  )
}

/**
 * Save a pasted image into `<vault>/.mdwriter/chat-attachments/` and splice a
 * markdown image reference into the composer at the caret. The relative path
 * is used so the agent (which runs from the vault root) can resolve it with
 * its Read tool.
 *
 * The function silently no-ops when there's no vault — the user is typing in
 * the empty-state shell.
 */
async function attachImage(
  bytes: Uint8Array,
  mime: string,
  ta: HTMLTextAreaElement | null,
  setDraft: React.Dispatch<React.SetStateAction<string>>,
) {
  const root = useStore.getState().rootPath
  if (!root) return
  const ext = mime === "image/png" ? "png"
    : mime === "image/jpeg" ? "jpg"
    : mime === "image/gif" ? "gif"
    : mime === "image/webp" ? "webp"
    : "png"
  const name = `paste-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`
  const rel = `.mdwriter/chat-attachments/${name}`
  const abs = joinPath(root, rel)
  try {
    await ipc.writeImage(abs, bytes)
  } catch (e) {
    console.error("[chat image paste] write failed:", e)
    return
  }
  const ref = `![${name}](${rel})`
  if (!ta) {
    setDraft((d) => (d ? `${d}\n${ref}` : ref))
    return
  }
  // Insert at the current caret position so pasting mid-prompt works.
  const start = ta.selectionStart ?? ta.value.length
  const end = ta.selectionEnd ?? ta.value.length
  const before = ta.value.slice(0, start)
  const after = ta.value.slice(end)
  const insertion = before.endsWith("\n") || before === "" ? ref : `\n${ref}`
  const next = before + insertion + after
  setDraft(next)
  const caret = (before + insertion).length
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(caret, caret)
  })
}

function SlashPopover({
  matches, activeIndex, onHover, onPick,
}: {
  matches: SlashCommand[]
  activeIndex: number
  onHover: (i: number) => void
  onPick: (cmd: SlashCommand) => void
}) {
  return (
    <div
      className="absolute left-0 right-0 bottom-[calc(100%+4px)] z-[100] rounded-lg bg-elevated border border-border-strong overflow-hidden"
      style={{ boxShadow: "0 12px 32px -8px oklch(0 0 0 / 0.55), 0 2px 4px oklch(0 0 0 / 0.3)" }}
    >
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle px-3 pt-2 pb-1">Commands</div>
      {matches.map((cmd, i) => {
        const active = i === Math.min(activeIndex, matches.length - 1)
        return (
          <button
            key={cmd.name}
            type="button"
            // onMouseDown rather than onClick so the textarea doesn't lose
            // focus before the handler runs (which would dismiss us first).
            onMouseDown={(e) => { e.preventDefault(); onPick(cmd) }}
            onMouseEnter={() => onHover(i)}
            className={`w-full flex items-start gap-2.5 px-3 py-2 text-left ${
              active ? "bg-accent-soft text-text" : "text-text-muted hover:text-text hover:bg-surface"
            }`}
          >
            <Lightning size={11} className="text-text-subtle flex-none mt-[3px]" />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[12px] text-text">/{cmd.name}</span>
                <span className="text-[12px]">{cmd.label}</span>
              </div>
              <div className="text-[11px] text-text-subtle truncate">{cmd.hint}</div>
            </div>
          </button>
        )
      })}
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
