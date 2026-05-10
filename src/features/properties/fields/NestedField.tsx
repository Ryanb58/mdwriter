export function NestedField({ value }: { value: unknown }) {
  return (
    <div className="text-[11px] text-text-subtle">
      <div className="mb-1">Nested — edit in raw mode (<span className="font-mono">⌘E</span>)</div>
      <pre className="font-mono text-[11px] bg-elevated border border-border rounded p-2 overflow-x-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
