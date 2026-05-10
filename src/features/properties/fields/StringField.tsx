export function StringField({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-[13px] rounded px-1.5 py-1 hover:bg-elevated focus:bg-elevated focus:ring-1 focus:ring-accent-soft transition-colors"
    />
  )
}
