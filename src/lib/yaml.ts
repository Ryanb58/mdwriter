// Re-serialize a frontmatter map and body into the canonical raw markdown the
// raw editor edits. Keep this in sync with Rust `serialize_doc`.
export function combineRaw(frontmatter: Record<string, unknown>, body: string): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) return body.replace(/^\n+/, "")
  // Simple YAML-of-known-shapes; for v1 we only round-trip strings/numbers/booleans/dates/arrays.
  // Anything more complex was already filtered by the inferType layer.
  const lines: string[] = []
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(formatYamlKv(key, value, 0))
  }
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\n+/, "")}`
}

function formatYamlKv(key: string, value: unknown, indent: number): string {
  const pad = "  ".repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}${key}: []`
    const items = value.map((v) => `${pad}  - ${yamlScalar(v)}`).join("\n")
    return `${pad}${key}:\n${items}`
  }
  if (value === null || value === undefined) return `${pad}${key}: null`
  return `${pad}${key}: ${yamlScalar(value)}`
}

function yamlScalar(v: unknown): string {
  if (typeof v === "string") {
    if (/[:#\-]|^\s|\s$/.test(v)) return JSON.stringify(v)
    return v
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (v === null || v === undefined) return "null"
  return JSON.stringify(v)
}
