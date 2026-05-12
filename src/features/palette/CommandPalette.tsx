import { useEffect, useMemo, useRef, useState } from "react"
import { Command } from "cmdk"
import { MagnifyingGlass, FileText, Sparkle, ArrowUp } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { useVaultNotes } from "../../lib/vaultNotes"
import { sendPrompt } from "../ai/useAiSession"
import {
  applyWikilinkSelection,
  detectMentionTrigger,
  type WikilinkTrigger,
} from "../ai/wikilinkDetect"
import { WikilinkPopover, useWikilinkResults } from "../ai/WikilinkPopover"

type Mode = "file" | "ask"

// Sentinel prefixes that switch into ask-mode from the regular palette.
function detectModeFromQuery(query: string): { mode: Mode; rest: string } {
  if (query.startsWith("> ")) return { mode: "ask", rest: query.slice(2) }
  if (query.startsWith(" ")) return { mode: "ask", rest: query.slice(1) }
  return { mode: "file", rest: query }
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [initialMode, setInitialMode] = useState<Mode>("file")
  const [query, setQuery] = useState("")

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === "p") {
        e.preventDefault()
        setInitialMode("file")
        setQuery("")
        setOpen((o) => !o)
      }
      if (meta && e.key === "k") {
        e.preventDefault()
        setInitialMode("ask")
        setQuery("")
        setOpen((o) => !o)
      }
      if (e.key === "Escape" && open) setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  if (!open) return null

  // When opened via Cmd+P, the user can pivot to ask-mode by typing `> ` or
  // a leading space. When opened via Cmd+K, we stay in ask-mode regardless.
  const { mode: derivedMode, rest } = initialMode === "ask"
    ? { mode: "ask" as const, rest: query }
    : detectModeFromQuery(query)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] bg-black/40 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[90vw]"
      >
        {derivedMode === "ask" ? (
          <AskMode
            initialQuery={rest}
            close={() => setOpen(false)}
          />
        ) : (
          <FileMode
            query={query}
            onQueryChange={setQuery}
            close={() => setOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

function FileMode({
  query,
  onQueryChange,
  close,
}: {
  query: string
  onQueryChange: (q: string) => void
  close: () => void
}) {
  const notes = useVaultNotes()
  const files = useMemo(
    () => notes.map((n) => ({ name: n.name + ".md", path: n.path, rel: n.rel })),
    [notes],
  )

  return (
    <Command
      className="rounded-xl bg-elevated border border-border-strong overflow-hidden"
      style={{ boxShadow: "0 24px 48px -12px oklch(0 0 0 / 0.6), 0 4px 8px oklch(0 0 0 / 0.3)" }}
    >
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
        <MagnifyingGlass size={14} className="text-text-subtle flex-none" />
        <Command.Input
          autoFocus
          value={query}
          onValueChange={onQueryChange}
          placeholder="Open file…   type a space to ask the agent"
          className="flex-1 outline-none text-[14px] placeholder:text-text-subtle"
        />
        <kbd className="text-[10px] font-mono text-text-subtle border border-border rounded px-1.5 py-0.5">esc</kbd>
      </div>
      <Command.List className="max-h-[360px] overflow-y-auto py-1.5">
        <Command.Empty className="px-4 py-6 text-[12px] text-text-subtle text-center">
          No matching files.
        </Command.Empty>
        {files.map((f) => {
          const folder = f.rel.replace(/[\\/]?[^\\/]+$/, "")
          return (
            <Command.Item
              key={f.path}
              value={`${f.rel} ${f.name}`}
              onSelect={() => {
                useStore.getState().setSelected(f.path)
                close()
              }}
              className="mx-1.5 px-2.5 py-1.5 rounded-md text-[13px] flex items-center gap-2.5 cursor-pointer aria-selected:bg-accent-soft aria-selected:text-text text-text-muted"
            >
              <FileText size={13} className="flex-none text-text-subtle" />
              <span className="truncate">{f.name.replace(/\.(md|markdown)$/i, "")}</span>
              {folder && (
                <span className="ml-auto text-[11px] text-text-subtle font-mono truncate">{folder}</span>
              )}
            </Command.Item>
          )
        })}
      </Command.List>
    </Command>
  )
}

function AskMode({ initialQuery, close }: { initialQuery: string; close: () => void }) {
  const [text, setText] = useState(initialQuery)
  const [trigger, setTrigger] = useState<WikilinkTrigger | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const setRightPane = useStore((s) => s.setRightPane)
  const notes = useVaultNotes()
  const results = useWikilinkResults(notes, trigger?.query ?? "")

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  useEffect(() => { setActiveIdx(0) }, [trigger?.query])

  function syncTrigger(value: string, caret: number) {
    setTrigger(detectMentionTrigger(value, caret))
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    setText(v)
    syncTrigger(v, e.target.selectionStart ?? v.length)
  }

  function selectNote(name: string) {
    if (!trigger) return
    const { value, caret } = applyWikilinkSelection(text, trigger, name)
    setText(value)
    setTrigger(null)
    requestAnimationFrame(() => {
      const el = taRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  function send() {
    const t = text.trim()
    if (!t) return
    setRightPane("ai")
    sendPrompt(t)
    close()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
      if ((e.key === "Enter" || e.key === "Tab") && results.length > 0 && !e.shiftKey) {
        e.preventDefault()
        selectNote(results[Math.min(activeIdx, results.length - 1)].name)
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
      send()
    }
  }

  return (
    <div
      className="rounded-xl bg-elevated border border-border-strong overflow-hidden"
      style={{ boxShadow: "0 24px 48px -12px oklch(0 0 0 / 0.6), 0 4px 8px oklch(0 0 0 / 0.3)" }}
    >
      <div className="flex items-start gap-2.5 px-4 py-3 border-b border-border relative">
        <Sparkle size={14} className="text-accent flex-none mt-1" />
        <textarea
          ref={taRef}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onSelect={(e) => syncTrigger(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
          rows={1}
          placeholder="Ask the agent…   type @ or [[ to reference a note"
          className="flex-1 resize-none bg-transparent outline-none text-[14px] leading-relaxed placeholder:text-text-subtle"
          style={{ maxHeight: 180 }}
        />
        {trigger && (
          <div className="absolute left-9 top-full">
            <WikilinkPopover
              notes={notes}
              query={trigger.query}
              activeIndex={activeIdx}
              onHover={setActiveIdx}
              onSelect={(n) => selectNote(n.name)}
              placement="below"
            />
          </div>
        )}
        <button
          type="button"
          onClick={send}
          disabled={!text.trim()}
          className="mt-0.5 p-1.5 rounded-md bg-accent text-accent-fg disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex-none"
          title="Send (Enter)"
          aria-label="Send"
        >
          <ArrowUp size={12} weight="bold" />
        </button>
      </div>
      <div className="px-4 py-2 text-[11px] text-text-subtle border-t border-border">
        <kbd className="font-mono">Enter</kbd> sends · <kbd className="font-mono">Shift+Enter</kbd> newline · <kbd className="font-mono">@</kbd> or <kbd className="font-mono">[[</kbd> reference
      </div>
    </div>
  )
}

export const __test__ = { detectModeFromQuery }
