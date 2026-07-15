import { Warning } from "@phosphor-icons/react"
import type { LoadError } from "../../lib/store"

export function DocumentLoadState({
  error,
  onRetry,
}: {
  error: LoadError
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-4 border-b border-border bg-danger/10 px-5 py-2.5 text-danger"
    >
      <div className="flex min-w-0 items-start gap-2">
        <Warning size={15} className="mt-0.5 flex-none" />
        <div className="min-w-0 text-[12px] leading-relaxed">
          <div className="font-medium">Couldn&apos;t open this note.</div>
          <div className="truncate opacity-80">{error.message}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="flex-none rounded border border-danger/30 px-2.5 py-1 text-[12px] font-medium hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30"
      >
        Retry
      </button>
    </div>
  )
}
