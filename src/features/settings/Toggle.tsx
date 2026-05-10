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
          "relative inline-block shrink-0 h-5 w-9 rounded-full",
          "transition-colors duration-150 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-elevated",
          "mt-0.5",
          on ? "bg-accent" : "bg-border-strong",
        ].join(" ")}
      >
        <span
          aria-hidden="true"
          className={[
            "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white",
            "transition-transform duration-150 ease-out",
            on ? "translate-x-4" : "translate-x-0",
          ].join(" ")}
          style={{ boxShadow: "0 1px 2px oklch(0 0 0 / 0.25)" }}
        />
      </button>
    </label>
  )
}
