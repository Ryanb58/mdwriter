export function Toggle({
  on, onChange, label, description, id,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  id?: string
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-4 py-3 cursor-pointer group">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text">{label}</div>
        {description && (
          <div className="text-[12px] text-text-subtle mt-0.5 leading-relaxed">{description}</div>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={[
          "relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full transition-colors mt-0.5",
          on ? "bg-accent" : "bg-border-strong",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-[14px] w-[14px] rounded-full bg-text transition-transform",
            "translate-y-[2px]",
            on ? "translate-x-[16px]" : "translate-x-[2px]",
          ].join(" ")}
        />
      </button>
    </label>
  )
}
