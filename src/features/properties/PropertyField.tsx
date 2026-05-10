import { inferType } from "./inferType"
import { StringField } from "./fields/StringField"
import { NumberField } from "./fields/NumberField"
import { BooleanField } from "./fields/BooleanField"
import { DateField } from "./fields/DateField"
import { ListField } from "./fields/ListField"
import { NestedField } from "./fields/NestedField"
import { X } from "@phosphor-icons/react"

export function PropertyField({
  name, value, onChange, onRemove,
}: {
  name: string
  value: unknown
  onChange: (v: unknown) => void
  onRemove: () => void
}) {
  const type = inferType(value)
  return (
    <div className="group grid grid-cols-[80px_1fr_auto] items-start gap-2 py-0.5">
      <div className="text-[11px] uppercase tracking-wider text-text-subtle pt-1.5 truncate" title={name}>
        {name}
      </div>
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
        className="opacity-0 group-hover:opacity-100 text-text-subtle hover:text-danger transition-all pt-1.5"
        title="Remove"
      >
        <X size={11} weight="bold" />
      </button>
    </div>
  )
}
