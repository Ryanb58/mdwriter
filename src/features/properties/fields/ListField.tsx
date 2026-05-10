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
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-neutral-700 rounded px-1.5 py-0.5 text-xs">
            {String(v)}
            <button onClick={() => remove(i)} className="opacity-60 hover:opacity-100">×</button>
          </span>
        ))}
      </div>
      <input
        value={draft}
        placeholder="Add item…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") add() }}
        className="bg-transparent border-b border-neutral-700 focus:border-blue-500 outline-none text-xs px-1 py-0.5"
      />
    </div>
  )
}
