import { useEffect, useRef, useState, useMemo, useCallback } from "react"
import { ArrowUp, Stop, TextAa, X, Lightning } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { useVaultNotes, type VaultNote } from "../../lib/vaultNotes"
import { sendPrompt, cancelSession } from "./useAiSession"
import {
  detectMentionTrigger,
  type WikilinkTrigger,
} from "./wikilinkDetect"
import { WikilinkPopover, useWikilinkResults } from "./WikilinkPopover"
import { basename, joinPath } from "../../lib/paths"
import { ipc } from "../../lib/ipc"
import { readClipboardImageAsPng } from "../../lib/imagePaste"
import { detectSlashTrigger, matchSlashCommands, type SlashCommand } from "./slashCommands"
import {
  insertLineBreakAtCaret,
  insertTextAtCaret,
  makePill,
  pillBeforeCaret,
  readEditorState,
  renderTextToEditor,
  setCaretAtTextOffset,
} from "./composerDOM"

const MAX_HEIGHT_PX = 220

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
  const editorRef = useRef<HTMLDivElement>(null)

  const slashQuery = useMemo(() => detectSlashTrigger(draft), [draft])
  const slashMatches = useMemo(
    () => (slashQuery == null ? [] : matchSlashCommands(slashQuery)),
    [slashQuery],
  )

  /** Push a new draft string and rebuild the DOM (used for slash command,
   *  edit-and-resend, picker selection — anything that changes structure). */
  const replaceDraft = useCallback((next: string, nextCaret = next.length) => {
    const root = editorRef.current
    if (!root) return
    renderTextToEditor(root, next)
    setDraft(next)
    setTrigger(detectMentionTrigger(next, nextCaret))
    requestAnimationFrame(() => {
      root.focus()
      setCaretAtTextOffset(root, nextCaret)
    })
  }, [])

  /** Read current editor state into React. The DOM is the source of truth; this
   *  is the canonical write path for any user-driven change. */
  const syncFromDOM = useCallback(() => {
    const root = editorRef.current
    if (!root) return
    const { text, caret } = readEditorState(root)
    setDraft(text)
    setTrigger(detectMentionTrigger(text, caret))
  }, [])

  // Honor externally-injected drafts ("Edit and resend"). The nonce keys the
  // effect so back-to-back requests with identical text still re-seed.
  useEffect(() => {
    if (!draftRequest) return
    replaceDraft(draftRequest.text)
    consumeAiDraftRequest()
  }, [draftRequest, consumeAiDraftRequest, replaceDraft])

  useEffect(() => {
    setActiveIdx(0)
  }, [trigger?.query])

  useEffect(() => {
    setSlashActiveIdx(0)
  }, [slashQuery])

  const results = useWikilinkResults(notes, trigger?.query ?? "")

  function selectNote(note: VaultNote) {
    if (!trigger) return
    // Replace the trigger range with a pill node + trailing space. The
    // textual model still uses `[[Name]]` so prompt building and persistence
    // don't change.
    const root = editorRef.current
    if (!root) {
      // Defensive fallback — should never hit in practice.
      replaceDraft(
        draft.slice(0, trigger.start) + `[[${note.name}]]` + draft.slice(trigger.end),
      )
      setTrigger(null)
      return
    }
    insertPillAtTrigger(root, draft, trigger, note.name)
    setTrigger(null)
    syncFromDOM()
    requestAnimationFrame(() => root.focus())
  }

  function submit() {
    if (running) return
    const t = draft.trim()
    if (!t) return
    sendPrompt(t)
    replaceDraft("")
    setTrigger(null)
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const cd = e.clipboardData
    if (!cd) return
    for (const item of Array.from(cd.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile()
        if (!file) continue
        e.preventDefault()
        const bytes = new Uint8Array(await file.arrayBuffer())
        const mime = file.type || "image/png"
        await attachImage(bytes, mime, draft, replaceDraft)
        return
      }
    }
    // WKWebView reports types=["Files"] with empty items/files for images.
    if (cd.items.length === 0 && cd.files.length === 0 && Array.from(cd.types).includes("Files")) {
      e.preventDefault()
      try {
        const bytes = await readClipboardImageAsPng()
        if (bytes) await attachImage(bytes, "image/png", draft, replaceDraft)
      } catch (err) {
        console.error("[chat image paste] failed:", err)
      }
      return
    }
    // Plain text paste — strip formatting from rich-text payloads so the
    // contenteditable doesn't inherit unwanted markup.
    const text = cd.getData("text/plain")
    if (text) {
      e.preventDefault()
      insertTextAtCaret(text)
      syncFromDOM()
    }
  }

  function applySlash(cmd: SlashCommand) {
    const ctx = {
      currentNoteName: openDocPath ? basename(openDocPath) : null,
      hasSelection,
    }
    replaceDraft(cmd.build(ctx))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Backspace: if a pill sits right behind the caret, atomically remove it.
    if (e.key === "Backspace") {
      const root = editorRef.current
      if (root) {
        const pill = pillBeforeCaret(root)
        if (pill) {
          e.preventDefault()
          pill.remove()
          syncFromDOM()
          return
        }
      }
    }

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
        replaceDraft("")
        return
      }
    }

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
      if (e.key === "Enter" && !e.shiftKey && results.length > 0) {
        e.preventDefault()
        selectNote(results[Math.min(activeIdx, results.length - 1)])
        return
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
      return
    }
    // Shift+Enter: insert a real `<br>` rather than letting contenteditable's
    // default behaviour drop a `<div>` (which would break our text serializer).
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault()
      insertLineBreakAtCaret()
      syncFromDOM()
      return
    }
  }

  const empty = draft.length === 0

  return (
    <div className="border-t border-border p-2.5" data-mdwriter-ai-composer>
      <SelectionChip />
      <div className="relative rounded-md border border-border bg-elevated focus-within:border-accent transition-colors">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Message"
          onInput={syncFromDOM}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          onBlur={() => setTrigger(null)}
          data-empty={empty}
          data-placeholder="Ask the agent…  type @ or [[ to reference a note · paste images"
          className="ai-composer-input w-full text-[13px] leading-relaxed px-2.5 py-2 pr-10 outline-none whitespace-pre-wrap break-words"
          style={{ maxHeight: MAX_HEIGHT_PX, overflowY: "auto" }}
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
 * Replace the `trigger` span in the contenteditable with a pill node + a
 * trailing space, then update React state by re-reading the DOM. Walks the
 * tree manually so we don't lose pills that already exist in the draft.
 */
function insertPillAtTrigger(
  root: HTMLDivElement,
  draft: string,
  trigger: WikilinkTrigger,
  noteName: string,
) {
  const range = textRangeFor(root, trigger.start, trigger.end)
  if (!range) return
  range.deleteContents()
  const pill = makePill(noteName)
  range.insertNode(pill)
  // Insert a single space after the pill so the user can keep typing without
  // their next character bleeding into the pill's atomic span boundary.
  const space = document.createTextNode(" ")
  pill.after(space)
  // Cursor right after the space.
  const sel = window.getSelection()
  if (sel) {
    const r = document.createRange()
    r.setStartAfter(space)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
  }
  void draft // referenced by callers for control flow; unused inside.
}

/**
 * Build a DOM Range covering the [startOffset, endOffset) text range inside
 * the editor. Walks the tree the same way `readEditorState` does, so
 * offsets line up with the serialized text the trigger detector saw.
 */
function textRangeFor(root: HTMLElement, startOffset: number, endOffset: number): Range | null {
  let acc = 0
  let startSet = false
  let endSet = false
  const range = document.createRange()

  function maybeSetStart(node: Node, offset: number) {
    if (!startSet) {
      range.setStart(node, offset)
      startSet = true
    }
  }
  function maybeSetEnd(node: Node, offset: number) {
    if (!endSet) {
      range.setEnd(node, offset)
      endSet = true
    }
  }

  function walk(node: Node): boolean {
    if (startSet && endSet) return true
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? "").length
      if (!startSet && startOffset >= acc && startOffset <= acc + len) {
        maybeSetStart(node, startOffset - acc)
      }
      if (!endSet && endOffset >= acc && endOffset <= acc + len) {
        maybeSetEnd(node, endOffset - acc)
      }
      acc += len
      return startSet && endSet
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false
    const el = node as HTMLElement
    if (el.classList.contains("ai-pill")) {
      const len = `[[${el.dataset.target ?? el.textContent ?? ""}]]`.length
      const parent = el.parentNode!
      const idx = Array.from(parent.childNodes).indexOf(el as ChildNode)
      if (!startSet && startOffset >= acc && startOffset <= acc + len) {
        maybeSetStart(parent, startOffset - acc < len / 2 ? idx : idx + 1)
      }
      if (!endSet && endOffset >= acc && endOffset <= acc + len) {
        maybeSetEnd(parent, endOffset - acc < len / 2 ? idx : idx + 1)
      }
      acc += len
      return startSet && endSet
    }
    if (el.tagName === "BR") {
      const parent = el.parentNode!
      const idx = Array.from(parent.childNodes).indexOf(el as ChildNode)
      if (!startSet && startOffset === acc) maybeSetStart(parent, idx)
      if (!endSet && endOffset === acc) maybeSetEnd(parent, idx)
      acc += 1
      if (!startSet && startOffset === acc) maybeSetStart(parent, idx + 1)
      if (!endSet && endOffset === acc) maybeSetEnd(parent, idx + 1)
      return startSet && endSet
    }
    for (const c of Array.from(el.childNodes)) {
      if (walk(c)) return true
    }
    return false
  }

  walk(root)
  if (!startSet) maybeSetStart(root, root.childNodes.length)
  if (!endSet) maybeSetEnd(root, root.childNodes.length)
  return range
}

/**
 * Save a pasted image into `<vault>/.mdwriter/chat-attachments/` and append
 * a markdown image reference to the draft. The relative path is used so the
 * agent (which runs from the vault root) can resolve it with its Read tool.
 * Silently no-ops when there's no vault.
 */
async function attachImage(
  bytes: Uint8Array,
  mime: string,
  draft: string,
  replaceDraft: (text: string, caret?: number) => void,
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
  const sep = draft && !draft.endsWith("\n") ? "\n" : ""
  const next = `${draft}${sep}${ref}`
  replaceDraft(next)
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
