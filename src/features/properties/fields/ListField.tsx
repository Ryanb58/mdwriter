import { useState } from "react"

export function ListField({
  value, onChange,
}: { value: unknown[]; onChange: (v: unknown[]) => void }) {
  const [draft, setDraft] = useState("")

  function add() {
    if (!draft.trim()) return
    onChange([...value, draft.trim()])
    setDraft("")
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }

  return (
    <div className="flex flex-col gap-1.5 py-0.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((v, i) => (
            <span
              key={i}
              className="group inline-flex items-center gap-1 rounded bg-elevated border border-border px-1.5 py-0.5 text-[12px]"
            >
              <span className="text-text">{String(v)}</span>
              <button
                onClick={() => remove(i)}
                className="text-text-subtle hover:text-danger transition-colors"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={draft}
        placeholder="Add item…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") add() }}
        className="text-[12px] rounded px-1.5 py-1 hover:bg-elevated focus:bg-elevated focus:ring-1 focus:ring-accent-soft placeholder:text-text-subtle transition-colors"
      />
    </div>
  )
}
