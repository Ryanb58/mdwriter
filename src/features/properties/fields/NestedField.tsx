export function NestedField({ value }: { value: unknown }) {
  return (
    <div className="text-xs italic opacity-60">
      nested object — edit in raw mode (Cmd+E)
      <pre className="text-[10px] opacity-70 mt-1">{JSON.stringify(value, null, 2)}</pre>
    </div>
  )
}
