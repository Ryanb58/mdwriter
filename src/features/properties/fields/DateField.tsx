export function DateField({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const dateOnly = value.slice(0, 10)
  return (
    <input
      type="date"
      value={dateOnly}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-[13px] font-mono rounded px-1.5 py-1 hover:bg-elevated focus:bg-elevated focus:ring-1 focus:ring-accent-soft transition-colors [color-scheme:dark]"
    />
  )
}
