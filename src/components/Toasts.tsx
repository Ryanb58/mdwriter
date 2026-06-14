import { useEffect, useState } from "react"
import { Info, Warning, X } from "@phosphor-icons/react"
import { dismissToast, subscribeToasts, type Toast } from "../lib/toast"

/**
 * Toast stack, bottom-left. (Bottom-right belongs to UpdateBanner —
 * see features/updates/UpdateBanner.tsx.)
 */
export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => subscribeToasts(setToasts), [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-9 left-3 z-[60] flex flex-col gap-2 w-[300px] max-w-[80vw] pointer-events-none">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  )
}

function ToastCard({ toast }: { toast: Toast }) {
  // Mount one frame hidden, then transition in (translate + opacity).
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const isError = toast.kind === "error"
  return (
    <div
      role="status"
      className={[
        "pointer-events-auto flex items-start gap-2 rounded-md border bg-elevated px-3 py-2 text-[12.5px] shadow-lg",
        "transition-all duration-200 ease-out",
        shown ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0",
        isError ? "border-danger/40 text-danger" : "border-border text-text",
      ].join(" ")}
    >
      {isError ? (
        <Warning size={14} weight="bold" className="mt-0.5 flex-none" />
      ) : (
        <Info size={14} className="mt-0.5 flex-none text-text-subtle" />
      )}
      <div className="flex-1 min-w-0 break-words">{toast.message}</div>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label="Dismiss"
        className="flex-none p-0.5 rounded text-text-subtle hover:text-text hover:bg-surface transition-colors"
      >
        <X size={11} weight="bold" />
      </button>
    </div>
  )
}
