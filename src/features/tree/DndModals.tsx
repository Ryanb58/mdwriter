import { useEffect, useState } from "react"
import { usePromptStore, type CollisionChoice } from "./dndPrompts"

/**
 * Confirm modal (used by multi-move and Finder import). Renders inline
 * in the root layout; consumed via the promise wrapper in dndPrompts.
 */
function ConfirmModal() {
  const req = usePromptStore((s) => s.confirm)
  const setConfirm = usePromptStore((s) => s.setConfirm)

  useEffect(() => {
    if (!req) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        req!.resolve(false)
        setConfirm(null)
      } else if (e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation()
        req!.resolve(true)
        setConfirm(null)
      }
    }
    // Capture phase so we beat the tree's document-level shortcut listener
    // (notably Escape, which would otherwise also collapse multi-selection).
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [req, setConfirm])

  if (!req) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={() => { req.resolve(false); setConfirm(null) }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] max-w-[92vw] rounded-lg border border-border-strong bg-elevated shadow-2xl"
      >
        <div className="px-5 pt-4 pb-2 text-[15px] font-semibold text-text">{req.title}</div>
        <div className="px-5 pb-3 text-[13px] text-text-muted">{req.message}</div>
        {req.details && req.details.length > 0 && (
          <div className="mx-5 mb-3 max-h-40 overflow-y-auto rounded border border-border bg-base/50 px-2.5 py-1.5 text-[12px] text-text-muted">
            {req.details.map((line, i) => (
              <div key={i} className="truncate font-mono">{line}</div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={() => { req.resolve(false); setConfirm(null) }}
            className="rounded-md px-3 py-1.5 text-[13px] text-text-muted hover:bg-base"
          >
            {req.cancelLabel}
          </button>
          <button
            autoFocus
            onClick={() => { req.resolve(true); setConfirm(null) }}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-fg hover:opacity-90"
          >
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function CollisionModal() {
  const req = usePromptStore((s) => s.collision)
  const setCollision = usePromptStore((s) => s.setCollision)
  const [applyToRest, setApplyToRest] = useState(false)

  // Reset the checkbox between independent collision prompts.
  useEffect(() => {
    setApplyToRest(false)
  }, [req])

  useEffect(() => {
    if (!req) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        choose("cancel")
      }
    }
    // Capture phase — see ConfirmModal for the reasoning.
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req, applyToRest])

  function choose(c: CollisionChoice) {
    if (!req) return
    req.resolve({ choice: c, applyToRest })
    setCollision(null)
  }

  if (!req) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={() => choose("cancel")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[460px] max-w-[92vw] rounded-lg border border-border-strong bg-elevated shadow-2xl"
      >
        <div className="px-5 pt-4 pb-1 text-[15px] font-semibold text-text">
          “{req.name}” already exists
        </div>
        <div className="px-5 pb-3 text-[13px] text-text-muted">
          in <span className="font-mono">{req.targetDir}</span>
        </div>
        {req.remaining > 0 && (
          <div className="mx-5 mb-3 rounded border border-border bg-base/50 px-2.5 py-1.5 text-[12px] text-text-muted">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={applyToRest}
                onChange={(e) => setApplyToRest(e.target.checked)}
              />
              <span>Apply to remaining {req.remaining} conflict{req.remaining === 1 ? "" : "s"}</span>
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={() => choose("cancel")}
            className="rounded-md px-3 py-1.5 text-[13px] text-text-muted hover:bg-base"
          >
            Cancel
          </button>
          <button
            onClick={() => choose("skip")}
            className="rounded-md border border-border px-3 py-1.5 text-[13px] text-text-muted hover:bg-base"
          >
            Skip
          </button>
          <button
            autoFocus
            onClick={() => choose("rename")}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-fg hover:opacity-90"
            title={`Rename to ${req.suggestedRename}`}
          >
            Rename to “{req.suggestedRename}”
          </button>
        </div>
      </div>
    </div>
  )
}

export function DndModals() {
  return (
    <>
      <ConfirmModal />
      <CollisionModal />
    </>
  )
}
