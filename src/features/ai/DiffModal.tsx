import { useEffect, useMemo } from "react"
import { Check, X } from "@phosphor-icons/react"
import { applyToOpenDoc, previewApply, type ApplyOp } from "./applyToNote"
import { diffLines } from "./lineDiff"

type Props = {
  op: ApplyOp
  /** Human-readable label for the operation (e.g. "Replace selection"). */
  label: string
  onClose: () => void
}

/**
 * Modal preview of an Apply operation. The user accepts to commit the change
 * (writes through `applyToOpenDoc`) or dismisses to bail out. Esc dismisses.
 */
export function DiffModal({ op, label, onClose }: Props) {
  const preview = useMemo(() => previewApply(op), [op])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  if (!preview) {
    return (
      <ModalShell onClose={onClose} title={label}>
        <div className="p-6 text-[13px] text-text-muted">
          Preview unavailable — the selection no longer matches the document.
        </div>
      </ModalShell>
    )
  }

  const diff = diffLines(preview.before, preview.after)
  const added = diff.filter((d) => d.kind === "add").length
  const removed = diff.filter((d) => d.kind === "remove").length

  const accept = () => {
    const result = applyToOpenDoc(op)
    if (!result.ok) {
      console.error("Apply failed:", result.reason)
    }
    onClose()
  }

  return (
    <ModalShell onClose={onClose} title={label}>
      <div className="px-4 py-2 border-b border-border flex items-center gap-3 text-[11px] text-text-subtle">
        <span className="text-[oklch(0.55_0.15_150)]">+{added} added</span>
        <span className="text-danger">−{removed} removed</span>
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-[11.5px] leading-[1.55]">
        {diff.length === 0 ? (
          <div className="p-6 text-text-muted text-center">No changes.</div>
        ) : (
          diff.map((line, i) => <DiffRow key={i} line={line} />)
        )}
      </div>
      <div className="border-t border-border px-4 py-2.5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1 rounded-md text-[12px] text-text-muted hover:text-text hover:bg-elevated"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={accept}
          className="px-3 py-1 rounded-md text-[12px] bg-accent text-accent-fg hover:opacity-90 flex items-center gap-1.5"
        >
          <Check size={11} weight="bold" />
          Apply
        </button>
      </div>
    </ModalShell>
  )
}

function DiffRow({ line }: { line: ReturnType<typeof diffLines>[number] }) {
  if (line.kind === "equal") {
    return (
      <div className="flex gap-2 px-3 text-text-subtle">
        <span className="w-3 flex-none select-none"> </span>
        <span className="whitespace-pre-wrap break-words">{line.text || " "}</span>
      </div>
    )
  }
  if (line.kind === "add") {
    return (
      <div className="flex gap-2 px-3 bg-[oklch(0.55_0.15_150_/_0.12)]">
        <span className="w-3 flex-none select-none text-[oklch(0.55_0.15_150)]">+</span>
        <span className="text-text whitespace-pre-wrap break-words">{line.text || " "}</span>
      </div>
    )
  }
  return (
    <div className="flex gap-2 px-3 bg-danger/12">
      <span className="w-3 flex-none select-none text-danger">−</span>
      <span className="text-text whitespace-pre-wrap break-words line-through decoration-danger/60">{line.text || " "}</span>
    </div>
  )
}

function ModalShell({
  onClose, title, children,
}: {
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-[1px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[min(720px,90vw)] h-[min(640px,80vh)] flex flex-col rounded-lg border border-border-strong bg-surface shadow-2xl">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <span className="text-[12px] font-medium text-text">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-text-subtle hover:text-text hover:bg-elevated"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X size={11} weight="bold" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
