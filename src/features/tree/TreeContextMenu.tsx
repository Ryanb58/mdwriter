import { useEffect, useRef } from "react"

type Action = { label: string; onClick: () => void; danger?: boolean }

export function TreeContextMenu({ x, y, actions, onClose }: {
  x: number; y: number; actions: Action[]; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-44 rounded-md bg-elevated border border-border-strong py-1 text-[13px]"
      style={{
        top: y,
        left: x,
        boxShadow: "0 8px 24px -8px oklch(0 0 0 / 0.55), 0 2px 4px oklch(0 0 0 / 0.3)",
      }}
    >
      {actions.map((a, i) => (
        <button
          key={a.label}
          onClick={() => { a.onClick(); onClose() }}
          className={[
            "w-full text-left px-3 py-1.5 transition-colors",
            a.danger ? "text-danger hover:bg-danger/10" : "text-text hover:bg-surface",
            i === 0 ? "" : "",
          ].join(" ")}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
