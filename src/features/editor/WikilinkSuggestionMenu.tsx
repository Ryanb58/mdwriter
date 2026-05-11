import { useEffect, useRef, useState } from "react"
import { FileText } from "@phosphor-icons/react"
import type { SuggestionMenuProps } from "@blocknote/react"

export type WikilinkMenuItem = {
  title: string
  subtitle: string
  target: string
}

/**
 * Custom suggestion menu component for BlockNote's [[ wikilink picker.
 * Tracks keyboard selection locally (BlockNote's wrapper hands us a list
 * of items and an onClick, but no selectedIndex when we supply a custom
 * component); listens at the document level for arrow keys / enter
 * because BlockNote keeps focus inside the contenteditable.
 */
export function WikilinkSuggestionMenu(
  props: SuggestionMenuProps<WikilinkMenuItem>,
) {
  const { items, onItemClick } = props
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Clamp active index when items change (e.g. user keeps typing).
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, items.length - 1)))
  }, [items])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (items.length === 0) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActive((i) => (i + 1) % items.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActive((i) => (i - 1 + items.length) % items.length)
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        const item = items[active]
        if (item) onItemClick?.(item)
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [items, active, onItemClick])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-idx="${active}"]`,
    )
    el?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (items.length === 0) {
    return (
      <div
        className="rounded-md bg-elevated border border-border-strong px-3 py-2 text-[12px] text-text-subtle"
        style={{ boxShadow: "0 12px 32px -8px oklch(0 0 0 / 0.55), 0 2px 4px oklch(0 0 0 / 0.3)" }}
      >
        No matching notes.
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="rounded-md bg-elevated border border-border-strong overflow-y-auto"
      style={{
        width: 320,
        maxHeight: 240,
        boxShadow: "0 12px 32px -8px oklch(0 0 0 / 0.55), 0 2px 4px oklch(0 0 0 / 0.3)",
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle px-3 pt-2 pb-1">
        Link a note
      </div>
      {items.map((item, i) => {
        const folder = item.subtitle.replace(/[\\/]?[^\\/]+$/, "")
        return (
          <button
            key={`${item.target}-${i}`}
            type="button"
            data-idx={i}
            onMouseDown={(e) => {
              e.preventDefault()
              onItemClick?.(item)
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
            <span className="truncate">{item.title}</span>
            {folder && (
              <span className="ml-auto text-[11px] text-text-subtle font-mono truncate">{folder}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
