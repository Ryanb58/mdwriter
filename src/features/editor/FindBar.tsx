import { useEffect, useMemo, useRef, useState } from "react"
import { CaretDown, CaretUp, X } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { getBody } from "../../lib/doc"
import { findOccurrences, lineAt, wrapIndex } from "./findInText"

const QUERY_DEBOUNCE_MS = 150

/**
 * In-document find bar (⌘F). Works in both editor modes by reusing the
 * existing search-jump machinery: every navigation sets a fresh
 * `pendingScroll` and whichever editor is mounted consumes it
 * (`findNthBlockMatch` in block mode, `scrollViewToMatch` in raw mode) and
 * flashes the target. The bar itself never touches the editors.
 *
 * Occurrence indices are computed against the same text the active editor
 * walks: the body (frontmatter stripped) in block mode, the full file text
 * in raw mode.
 */
export function FindBar() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // True between issuing a pendingScroll and the editor consuming it —
  // used to pull focus back into the input after the raw editor's jump
  // focuses the CM view.
  const issuedNav = useRef(false)
  // False until the first jump for the current query, so Enter right after
  // typing lands on the current match instead of skipping past it when the
  // debounce already fired.
  const hasJumped = useRef(false)

  const doc = useStore((s) => s.openDoc)
  const editorMode = useStore((s) => s.editorMode)
  const setPendingScroll = useStore((s) => s.setPendingScroll)
  const pendingScroll = useStore((s) => s.pendingScroll)

  // The text the active editor actually walks for occurrences: block mode
  // strips frontmatter, raw mode displays the full file.
  const haystack = doc ? (editorMode === "block" ? getBody(doc.text) : doc.text) : ""
  const occurrences = useMemo(() => findOccurrences(haystack, query), [haystack, query])
  const total = occurrences.length
  const displayIdx = Math.min(idx, Math.max(0, total - 1))

  function jump(nextIdx: number) {
    const d = useStore.getState().openDoc
    if (!d || !query || total === 0) return
    const i = wrapIndex(nextIdx, total)
    setIdx(i)
    issuedNav.current = true
    hasJumped.current = true
    // Always a fresh object — the editor consumes and nulls pendingScroll,
    // so re-setting the same occurrence still triggers a jump + flash.
    setPendingScroll({
      path: d.path,
      line: lineAt(haystack, occurrences[i]),
      matchText: query,
      occurrence: i,
    })
  }
  const jumpRef = useRef(jump)
  jumpRef.current = jump

  // ⌘F opens (or re-focuses) the bar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      if (e.key !== "f" && e.key !== "F") return
      // Yield when something else (e.g. an editor keymap) claimed the
      // keystroke, or while a modal dialog is up.
      if (e.defaultPrevented) return
      if (document.querySelector('[aria-modal="true"]')) return
      // Don't hijack ⌘F from other text inputs (command palette, properties
      // fields) — only the editors and the find bar itself participate.
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA") &&
        !t.closest("[data-find-bar]")
      ) {
        return
      }
      e.preventDefault()
      setOpen(true)
      // Re-invocation while already open: refocus and select for retyping.
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  // Debounced jump-to-first-match as the query changes.
  useEffect(() => {
    if (!open) return
    setIdx(0)
    hasJumped.current = false
    if (!query) return
    const t = setTimeout(() => jumpRef.current(0), QUERY_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, open])

  // The raw editor's jump focuses the CM view, stealing focus mid-typing.
  // Once the editor consumed our pendingScroll (it nulls it), pull focus
  // back into the input without disturbing the scroll position.
  useEffect(() => {
    if (!open) return
    if (pendingScroll === null && issuedNav.current) {
      issuedNav.current = false
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [pendingScroll, open])

  function close() {
    // Capture the editor container before the bar unmounts so we can hand
    // focus back to whichever editor (CM or BlockNote contenteditable) is up.
    const pane = rootRef.current?.parentElement
    setOpen(false)
    requestAnimationFrame(() => {
      pane?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
    })
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      const step = e.shiftKey ? -1 : 1
      jump(hasJumped.current ? idx + step : idx)
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      jump(hasJumped.current ? idx + 1 : idx)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      jump(hasJumped.current ? idx - 1 : idx)
    } else if (e.key === "Escape") {
      e.preventDefault()
      close()
    }
  }

  if (!open || !doc) return null

  return (
    <div
      ref={rootRef}
      data-find-bar
      className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-md border border-border bg-elevated px-2 py-1 text-[12px] shadow-sm"
    >
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onInputKey}
        placeholder="Find in note"
        aria-label="Find in note"
        className="w-40 bg-transparent outline-none rounded-sm text-text placeholder:text-text-subtle focus-visible:ring-1 focus-visible:ring-accent"
      />
      <span className="text-text-subtle tabular-nums min-w-[3ch] text-right flex-none">
        {query ? (total === 0 ? "0" : `${displayIdx + 1}/${total}`) : ""}
      </span>
      <button
        type="button"
        onClick={() => jump(idx - 1)}
        disabled={total === 0}
        aria-label="Previous match"
        title="Previous match (⇧↩)"
        className="p-0.5 rounded text-text-subtle hover:text-text hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent transition-colors flex-none"
      >
        <CaretUp size={12} weight="bold" />
      </button>
      <button
        type="button"
        onClick={() => jump(idx + 1)}
        disabled={total === 0}
        aria-label="Next match"
        title="Next match (↩)"
        className="p-0.5 rounded text-text-subtle hover:text-text hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent transition-colors flex-none"
      >
        <CaretDown size={12} weight="bold" />
      </button>
      <button
        type="button"
        onClick={close}
        aria-label="Close find"
        title="Close (esc)"
        className="p-0.5 rounded text-text-subtle hover:text-text hover:bg-surface transition-colors flex-none"
      >
        <X size={12} weight="bold" />
      </button>
    </div>
  )
}
