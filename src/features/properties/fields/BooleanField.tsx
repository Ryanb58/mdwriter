export function BooleanField({
  value, onChange,
}: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={[
        "inline-flex items-center px-2.5 py-1 rounded-md text-[12px] font-medium",
        "border transition-colors",
        value
          ? "bg-accent-soft text-text border-accent-soft"
          : "bg-elevated text-text-muted border-border hover:text-text",
      ].join(" ")}
    >
      {value ? "true" : "false"}
    </button>
  )
}
