import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { FileText } from "@phosphor-icons/react"
import type { EditorView } from "@codemirror/view"
import type { VaultNote } from "../../lib/vaultNotes"
import { applyWikilinkInsertion, filterNotes, type WikilinkCompletionState } from "./wikilinkCM"

type Props = {
  state: WikilinkCompletionState | null
  notes: VaultNote[]
  viewRef: React.RefObject<EditorView | null>
}

/**
 * Floating note picker for the raw markdown editor. The CodeMirror plugin
 * computes the current `[[query` trigger and hands us the pixel coords;
 * we render the menu as a portal so it isn't clipped by the editor's
 * `overflow: auto`.
 *
 * Keyboard handling is attached to the document so the editor keeps focus
 * — the popup never becomes the active element.
 */
export function RawWikilinkPopup({ state, notes, viewRef }: Props) {
  const results = state ? filterNotes(notes, state.query) : []
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setActive(0)
  }, [state?.query])

  useEffect(() => {
    if (!state) return
    function onKey(e: KeyboardEvent) {
      if (!state) return
      if (results.length === 0 && e.key !== "Escape") return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActive((i) => (i + 1) % results.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActive((i) => (i - 1 + results.length) % results.length)
      } else if (e.key === "Enter" || e.key === "Tab") {
        const view = viewRef.current
        const pick = results[active]
        if (view && pick) {
          e.preventDefault()
          applyWikilinkInsertion(view, state.from, state.to, pick.name)
        }
      } else if (e.key === "Escape") {
        const view = viewRef.current
        if (view) {
          e.preventDefault()
          // Insert a single space so the trigger no longer matches; this
          // closes the popup on next selection update.
          view.dispatch({
            changes: { from: state.to, to: state.to, insert: " " },
            selection: { anchor: state.to + 1 },
          })
        }
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [state, results, active, viewRef])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (!state || !state.coords) return null

  const top = state.coords.bottom + 4
  const left = state.coords.left
  return createPortal(
    <div
      ref={listRef}
      className="fixed z-50 rounded-md bg-elevated border border-border-strong overflow-y-auto"
      style={{
        top,
        left,
        width: 320,
        maxHeight: 240,
        boxShadow: "0 12px 32px -8px oklch(0 0 0 / 0.55), 0 2px 4px oklch(0 0 0 / 0.3)",
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle px-3 pt-2 pb-1">
        Link a note
      </div>
      {results.length === 0 ? (
        <div className="px-3 pb-2 text-[12px] text-text-subtle">No matching notes.</div>
      ) : (
        results.map((n, i) => {
          const folder = n.rel.replace(/[\\/]?[^\\/]+$/, "")
          return (
            <button
              key={n.path}
              type="button"
              data-idx={i}
              onMouseDown={(e) => {
                e.preventDefault()
                const view = viewRef.current
                if (view) applyWikilinkInsertion(view, state.from, state.to, n.name)
              }}
              onMouseEnter={() => setActive(i)}
              className={[
                "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px]",
                i === active
                  ? "bg-accent-soft text-text"
                  : "text-text-muted hover:bg-surface",
              ].join(" ")}
            >
              <FileText size={12} className="flex-none text-text-subtle" />
              <span className="truncate">{n.name}</span>
              {folder && (
                <span className="ml-auto text-[11px] text-text-subtle font-mono truncate">{folder}</span>
              )}
            </button>
          )
        })
      )}
    </div>,
    document.body,
  )
}
