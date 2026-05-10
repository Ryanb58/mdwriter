export function NumberField({
  value, onChange,
}: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full bg-transparent border-b border-neutral-700 focus:border-blue-500 outline-none px-1 py-0.5 text-sm"
    />
  )
}
