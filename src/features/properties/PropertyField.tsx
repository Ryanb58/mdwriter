import { inferType } from "./inferType"
import { StringField } from "./fields/StringField"
import { NumberField } from "./fields/NumberField"
import { BooleanField } from "./fields/BooleanField"
import { DateField } from "./fields/DateField"
import { ListField } from "./fields/ListField"
import { NestedField } from "./fields/NestedField"

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
    <div className="flex items-start gap-2 py-1 group">
      <div className="w-24 text-xs opacity-60 pt-1 truncate">{name}</div>
      <div className="flex-1">
        {type === "string" && <StringField value={value as string} onChange={onChange} />}
        {type === "number" && <NumberField value={value as number} onChange={onChange} />}
        {type === "boolean" && <BooleanField value={value as boolean} onChange={onChange} />}
        {type === "date" && <DateField value={value as string} onChange={onChange} />}
        {type === "list" && <ListField value={value as unknown[]} onChange={onChange as (v: unknown[]) => void} />}
        {type === "nested" && <NestedField value={value} />}
        {type === "null" && <StringField value="" onChange={onChange} />}
      </div>
      <button onClick={onRemove} className="opacity-0 group-hover:opacity-100 text-xs opacity-50 hover:opacity-100">×</button>
    </div>
  )
}
