export function StringField({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent border-b border-neutral-700 focus:border-blue-500 outline-none px-1 py-0.5 text-sm"
    />
  )
}
