export function NumberField({
  value, onChange,
}: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full text-[13px] font-mono rounded px-1.5 py-1 hover:bg-elevated focus:bg-elevated focus:ring-1 focus:ring-accent-soft transition-colors"
    />
  )
}
