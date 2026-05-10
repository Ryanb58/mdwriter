import { useEffect, useLayoutEffect, useRef, useState } from "react"

export type ContextAction = {
  label: string
  onClick: () => void
  icon?: React.ReactNode
  shortcut?: string
  danger?: boolean
}

export type ContextActionGroup = ContextAction[]

export function TreeContextMenu({
  x, y, groups, onClose,
}: {
  x: number
  y: number
  groups: ContextActionGroup[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: y, left: x })

  // Dismiss on outside click + Escape
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  // Flip the menu if it would overflow viewport edges.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    let top = y
    let left = x
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin)
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin)
    }
    if (top !== y || left !== x) setPos({ top, left })
  }, [x, y])

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[200px] rounded-lg border border-border-strong bg-elevated py-1 text-[13px] select-none"
      style={{
        top: pos.top,
        left: pos.left,
        boxShadow: "0 12px 32px -8px oklch(0 0 0 / 0.55), 0 2px 4px oklch(0 0 0 / 0.3)",
      }}
    >
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="my-1 border-t border-border" aria-hidden="true" />}
          {group.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              onClick={() => { a.onClick(); onClose() }}
              className={[
                "group/item w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md mx-1 transition-colors",
                "outline-none focus-visible:bg-accent-soft",
                a.danger
                  ? "text-danger hover:bg-danger/15"
                  : "text-text-muted hover:bg-accent hover:text-accent-fg",
              ].join(" ")}
              style={{ width: "calc(100% - 8px)" }}
            >
              <span className="w-4 flex-none flex items-center justify-center text-text-subtle group-hover/item:text-current">
                {a.icon}
              </span>
              <span className="flex-1 text-left truncate">{a.label}</span>
              {a.shortcut && (
                <kbd className="font-mono text-[11px] text-text-subtle group-hover/item:text-current opacity-80">
                  {a.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
