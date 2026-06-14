import { useState } from "react"
import { inferType } from "./inferType"
import { StringField } from "./fields/StringField"
import { NumberField } from "./fields/NumberField"
import { BooleanField } from "./fields/BooleanField"
import { DateField } from "./fields/DateField"
import { ListField } from "./fields/ListField"
import { NestedField } from "./fields/NestedField"
import { X } from "@phosphor-icons/react"

/**
 * One frontmatter property: an editable `key` on the left and a
 * type-appropriate value editor on the right. Both the label and the value
 * are human-editable and write straight back to the document's YAML.
 */
export function PropertyField({
  name, value, onChange, onRename, onRemove,
}: {
  name: string
  value: unknown
  onChange: (v: unknown) => void
  onRename: (next: string) => void
  onRemove: () => void
}) {
  const type = inferType(value)
  return (
    <div className="group grid grid-cols-[minmax(72px,34%)_1fr_auto] items-center gap-2">
      <KeyLabel name={name} onRename={onRename} />
      <div className="min-w-0">
        {type === "string" && <StringField value={value as string} onChange={onChange} />}
        {type === "number" && <NumberField value={value as number} onChange={onChange} />}
        {type === "boolean" && <BooleanField value={value as boolean} onChange={onChange} />}
        {type === "date" && <DateField value={value as string} onChange={onChange} />}
        {type === "list" && <ListField value={value as unknown[]} onChange={onChange as (v: unknown[]) => void} />}
        {type === "nested" && <NestedField value={value} />}
        {type === "null" && <StringField value="" onChange={onChange} />}
      </div>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-text-subtle hover:text-danger transition-[opacity,color] duration-150 p-1 -m-1 rounded"
        title={`Remove "${name}"`}
        aria-label={`Remove ${name}`}
      >
        <X size={11} weight="bold" />
      </button>
    </div>
  )
}

/** The property key — click to rename. Enter commits, Escape cancels. */
function KeyLabel({ name, onRename }: { name: string; onRename: (next: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  function begin() {
    setDraft(name)
    setEditing(true)
  }
  function commit() {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== name) onRename(next)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit() }
          if (e.key === "Escape") { e.preventDefault(); setEditing(false) }
        }}
        aria-label="Property name"
        className="min-w-0 text-[12px] font-medium text-text bg-elevated border border-border-strong rounded px-1.5 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={begin}
      title={`${name} — click to rename`}
      className="min-w-0 truncate text-left text-[12px] font-medium text-text-muted hover:text-text rounded px-1.5 py-1 -mx-1.5 hover:bg-elevated/60 transition-colors cursor-text"
    >
      {name}
    </button>
  )
}
