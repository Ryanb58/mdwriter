import { useStore } from "../../lib/store"
import { CaretUpDown, Robot, CircleNotch } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

type Props = {
  /** Where the menu opens relative to the trigger. Default below. */
  placement?: "above" | "below"
  /** Visual variant — `panel` is roomy, `compact` is for the status bar. */
  variant?: "panel" | "compact"
}

export function AgentPicker({ placement = "below", variant = "panel" }: Props = {}) {
  const aiAgent = useStore((s) => s.aiAgent)
  const setAiAgent = useStore((s) => s.setAiAgent)
  const available = useStore((s) => s.aiAvailable)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const current = available.find((r) => r.id === aiAgent)
  const label = current?.label ?? "Claude Code"
  const menuClass = placement === "above"
    ? "right-0 bottom-[calc(100%+4px)]"
    : "left-0 top-[calc(100%+4px)]"

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={[
          variant === "compact"
            ? "flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors"
            : "flex items-center gap-1.5 px-2 py-1 rounded text-[12px] transition-colors",
          open ? "bg-elevated text-text" : "text-text-muted hover:text-text hover:bg-elevated",
        ].join(" ")}
        title={`AI agent: ${label}`}
      >
        <Robot size={variant === "compact" ? 11 : 12} weight="bold" className="text-text-subtle" />
        <span className="font-medium">{label}</span>
        <CaretUpDown size={variant === "compact" ? 9 : 10} className="text-text-subtle" />
      </button>
      {open && (
        <div
          className={`absolute ${menuClass} w-[280px] rounded-lg bg-elevated border border-border-strong overflow-hidden z-20`}
          style={{ boxShadow: "0 12px 32px -8px oklch(0 0 0 / 0.55), 0 2px 4px oklch(0 0 0 / 0.3)" }}
        >
          <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle px-3 pt-2 pb-1">Agent</div>
          {available.map((row) => {
            const disabled = !row.available || !row.implemented
            const status = !row.implemented
              ? "Coming soon"
              : !row.available
                ? "Not installed"
                : null
            return (
              <button
                key={row.id}
                disabled={disabled}
                onClick={() => { setAiAgent(row.id); setOpen(false) }}
                className={[
                  "w-full flex items-start gap-2.5 px-3 py-2 text-left",
                  disabled
                    ? "text-text-subtle cursor-not-allowed"
                    : row.id === aiAgent
                      ? "bg-accent-soft text-text"
                      : "text-text-muted hover:text-text hover:bg-surface",
                ].join(" ")}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{row.label}</div>
                  {row.binaryPath && row.implemented && (
                    <div className="text-[11px] text-text-subtle font-mono truncate">{row.binaryPath}</div>
                  )}
                </div>
                {status && <span className="text-[11px] text-text-subtle flex-none">{status}</span>}
              </button>
            )
          })}
          {available.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-text-subtle flex items-center gap-2">
              <CircleNotch size={12} className="animate-spin" />
              Detecting agents…
            </div>
          )}
        </div>
      )}
    </div>
  )
}
