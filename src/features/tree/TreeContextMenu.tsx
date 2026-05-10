import { useEffect, useRef } from "react"

type Action = { label: string; onClick: () => void }

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
      className="fixed z-50 min-w-40 rounded-md bg-neutral-900 border border-neutral-700 py-1 shadow-lg text-sm"
      style={{ top: y, left: x }}
    >
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => { a.onClick(); onClose() }}
          className="w-full text-left px-3 py-1 hover:bg-neutral-700"
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
