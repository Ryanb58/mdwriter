export function BooleanField({
  value, onChange,
}: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`px-2 py-0.5 rounded text-xs ${value ? "bg-blue-600 text-white" : "bg-neutral-700"}`}
    >{value ? "true" : "false"}</button>
  )
}
