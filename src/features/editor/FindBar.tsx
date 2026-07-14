import { useEffect, useMemo, useRef, useState } from "react"
import { CaretDown, CaretUp, X } from "@phosphor-icons/react"
import { useStore, type PendingScroll } from "../../lib/store"
import { findRanges, wrapIndex } from "./findInText"
import { findRenderedBlockMatches } from "./blockTextSearch"

const QUERY_DEBOUNCE_MS = 150

/** In-note Find uses exact ranges from whichever editor is currently visible. */
export function FindBar() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const hasJumped = useRef(false)
  const requestId = useRef(0)

  const doc = useStore((state) => state.openDoc)
  const docRev = useStore((state) => state.docRev)
  const editorMode = useStore((state) => state.editorMode)
  const blockTextIndex = useStore((state) => state.blockTextIndex)
  const setPendingScroll = useStore((state) => state.setPendingScroll)

  const expectedDocKey = doc ? `${doc.path}#${docRev}` : ""
  const activeBlockIndex =
    doc &&
    blockTextIndex?.path === doc.path &&
    blockTextIndex.docKey === expectedDocKey
      ? blockTextIndex
      : null

  const rawMatches = useMemo(
    () => editorMode === "raw" && doc ? findRanges(doc.text, query) : [],
    [doc?.text, editorMode, query],
  )
  const blockMatches = useMemo(
    () => editorMode === "block"
      ? findRenderedBlockMatches(activeBlockIndex?.blocks, query)
      : [],
    [activeBlockIndex?.blocks, editorMode, query],
  )
  const total = editorMode === "raw" ? rawMatches.length : blockMatches.length
  const displayIdx = Math.min(idx, Math.max(0, total - 1))
  const domainKey = editorMode === "raw"
    ? `raw:${expectedDocKey}`
    : `block:${expectedDocKey}:${activeBlockIndex?.docKey ?? "pending"}`

  function targetAt(index: number): PendingScroll | null {
    if (!doc) return null
    const nextRequestId = ++requestId.current
    if (editorMode === "raw") {
      const match = rawMatches[index]
      return match
        ? { kind: "find-raw", path: doc.path, ...match, requestId: nextRequestId }
        : null
    }
    const match = blockMatches[index]
    return match
      ? {
          kind: "find-block",
          path: doc.path,
          blockId: match.blockId,
          from: match.from,
          to: match.to,
          requestId: nextRequestId,
        }
      : null
  }

  function jump(nextIdx: number) {
    if (!doc || !query || total === 0) return
    const next = wrapIndex(nextIdx, total)
    const target = targetAt(next)
    if (!target) return
    setIdx(next)
    hasJumped.current = true
    setPendingScroll(target)
  }
  const jumpRef = useRef(jump)
  jumpRef.current = jump

  // Cmd/Ctrl+F opens or re-focuses the bar without pulling focus into either
  // editor. Editor-specific target handling also leaves this input focused.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      if (event.key !== "f" && event.key !== "F") return
      if (event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
        !target.closest("[data-find-bar]")
      ) {
        return
      }
      event.preventDefault()
      setOpen(true)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  // A new query, note, mode, or freshly-published BlockNote index starts at
  // the first match. The short delay keeps typing responsive.
  useEffect(() => {
    setIdx(0)
    hasJumped.current = false
    clearExactFindTarget()
    if (!open || !query) return
    const timer = window.setTimeout(() => jumpRef.current(0), QUERY_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, open, domainKey])

  // Local edits can remove earlier matches or shift the active exact range.
  // Clamp derived state and refresh only after this query has already jumped.
  useEffect(() => {
    if (!open || !query || !hasJumped.current) return
    if (total === 0) {
      setIdx(0)
      clearExactFindTarget()
      return
    }
    const next = Math.min(idx, total - 1)
    if (next !== idx) setIdx(next)
    const desired = targetAt(next)
    if (!desired) return
    const current = useStore.getState().pendingScroll
    // CodeMirror maps its decoration through document edits. BlockNote uses
    // host-owned geometry overlays, so every newly-published rendered index
    // must redraw even when the semantic block/range is unchanged.
    if (editorMode === "block" || !sameExactTarget(current, desired)) {
      setPendingScroll(desired)
    }
  }, [blockMatches, rawMatches, total, idx, open, query, editorMode])

  // FindBar normally stays mounted, but a surrounding editor teardown should
  // not leave an exact decoration alive in session state.
  useEffect(() => () => clearExactFindTarget(), [])

  function clearExactFindTarget() {
    const pending = useStore.getState().pendingScroll
    if (pending?.kind === "find-raw" || pending?.kind === "find-block") {
      useStore.getState().setPendingScroll(null)
    }
  }

  function close() {
    const pane = rootRef.current?.parentElement
    clearExactFindTarget()
    setOpen(false)
    requestAnimationFrame(() => {
      pane?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
    })
  }

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault()
      const step = event.shiftKey ? -1 : 1
      jump(hasJumped.current ? displayIdx + step : displayIdx)
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      jump(hasJumped.current ? displayIdx + 1 : displayIdx)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      jump(hasJumped.current ? displayIdx - 1 : displayIdx)
    } else if (event.key === "Escape") {
      event.preventDefault()
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
        onChange={(event) => setQuery(event.target.value)}
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
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => jump(displayIdx - 1)}
        disabled={total === 0}
        aria-label="Previous match"
        title="Previous match (⇧↩)"
        className="p-0.5 rounded text-text-subtle hover:text-text hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent transition-colors flex-none"
      >
        <CaretUp size={12} weight="bold" />
      </button>
      <button
        type="button"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => jump(displayIdx + 1)}
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

function sameExactTarget(left: PendingScroll | null, right: PendingScroll): boolean {
  if (!left || left.kind !== right.kind || left.path !== right.path) return false
  if (left.kind === "find-raw" && right.kind === "find-raw") {
    return left.from === right.from && left.to === right.to
  }
  if (left.kind === "find-block" && right.kind === "find-block") {
    return left.blockId === right.blockId && left.from === right.from && left.to === right.to
  }
  return false
}
