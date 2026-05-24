/**
 * Pure helpers over the canonical document text. `text` is the full file
 * contents — frontmatter (if any) is a `[start, end)` byte slice; everything
 * after is the body. All mutations are string → string; no state.
 *
 * Invariants:
 * - Body bytes are preserved verbatim when only frontmatter is mutated.
 * - Frontmatter bytes are preserved verbatim when only body is mutated.
 * - Removing the last frontmatter field removes the entire `---` block.
 */

export type ParsedDoc = {
  /** `[start, end)` byte range of the frontmatter region (including the
   *  `---\n` fences and the single trailing newline) or `null` if absent. */
  frontmatterRange: { start: number; end: number } | null
  /** Parsed scalar/array values from the YAML region. Empty when no FM. */
  values: Record<string, unknown>
  /** The body slice — equal to `text.slice(frontmatterRange?.end ?? 0)`. */
  body: string
  /** YAML parse error (if any). When set, `values` is best-effort and may
   *  be empty. */
  parseError: string | null
}

// Open with `---\n`, capture YAML up to a closing `---` on its own line,
// then optionally consume the single trailing newline after the closing
// fence. Lazy quantifier so the shortest valid match wins.
const FM_RE = /^---\n([\s\S]*?\n)---(?:\r?\n)?/

export function parseDoc(text: string): ParsedDoc {
  const m = text.match(FM_RE)
  if (!m) return { frontmatterRange: null, values: {}, body: text, parseError: null }
  const matchEnd = m[0].length
  const yamlSrc = m[1]
  let values: Record<string, unknown> = {}
  let parseError: string | null = null
  try {
    values = parseSimpleYaml(yamlSrc)
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e)
  }
  // Consume one more newline after the closing fence so the body slice
  // starts at the first real content character.
  const bodyStart = text[matchEnd] === "\n" ? matchEnd + 1 : matchEnd
  return {
    frontmatterRange: { start: 0, end: bodyStart },
    values,
    body: text.slice(bodyStart),
    parseError,
  }
}

export function getBody(text: string): string {
  return parseDoc(text).body
}

export function setBody(text: string, body: string): string {
  const r = parseDoc(text)
  if (!r.frontmatterRange) return body
  return text.slice(0, r.frontmatterRange.end) + body
}

export function getFrontmatterValues(text: string): Record<string, unknown> {
  return parseDoc(text).values
}

export function setFrontmatterField(text: string, key: string, value: unknown): string {
  const r = parseDoc(text)
  // No-op when the new value structurally equals the existing one. Lets the
  // caller patch on every keystroke without producing a string-different
  // result that would mark the doc dirty.
  if (key in r.values && deepEqual(r.values[key], value)) return text
  const next = { ...r.values, [key]: value }
  return rebuild(next, r.body)
}

export function removeFrontmatterField(text: string, key: string): string {
  const r = parseDoc(text)
  if (!(key in r.values)) return text
  const next = { ...r.values }
  delete next[key]
  return rebuild(next, r.body)
}

function rebuild(values: Record<string, unknown>, body: string): string {
  const keys = Object.keys(values)
  if (keys.length === 0) return body
  const yaml = keys.map((k) => formatYamlKv(k, values[k])).join("\n")
  // Canonical layout: `---\n<yaml>\n---\n\n<body>`. Strip the body's
  // existing leading newlines so toggling between "has FM" and "no FM"
  // doesn't accumulate blank lines.
  return `---\n${yaml}\n---\n\n${body.replace(/^\n+/, "")}`
}

function formatYamlKv(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`
    const items = value.map((v) => `  - ${yamlScalar(v)}`).join("\n")
    return `${key}:\n${items}`
  }
  if (value === null || value === undefined) return `${key}: null`
  return `${key}: ${yamlScalar(value)}`
}

function yamlScalar(v: unknown): string {
  if (typeof v === "string") {
    // Quote when the value contains YAML-significant characters or
    // leading/trailing whitespace; otherwise emit unquoted.
    if (/[:#\-]|^\s|\s$/.test(v)) return JSON.stringify(v)
    return v
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (v === null || v === undefined) return "null"
  return JSON.stringify(v)
}

// Tiny YAML subset: scalars (string/number/bool/null) + one-level bullet
// arrays + `# comment` lines + blank lines. Lenient: lines that don't
// look like `key: value` (e.g. inline-JSON nested values, anchors,
// stray text) are skipped rather than throwing, matching the prior
// `parseSimpleYaml` behavior in useEditorMode.ts so files that worked
// before continue to work.
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const lines = yaml.split("\n")
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue }
    const kv = line.match(/^(\S+):\s*(.*)$/)
    if (!kv) { i++; continue }
    const [, key, valueRaw] = kv
    const value = valueRaw.trim()
    if (value === "") {
      const items: unknown[] = []
      i++
      while (i < lines.length && /^\s+-\s/.test(lines[i])) {
        items.push(parseScalar(lines[i].replace(/^\s+-\s/, "")))
        i++
      }
      out[key] = items
      continue
    }
    out[key] = parseScalar(value)
    i++
  }
  return out
}

function parseScalar(s: string): unknown {
  s = s.trim()
  if (s === "null" || s === "~") return null
  if (s === "true") return true
  if (s === "false") return false
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  if (s.startsWith('"') && s.endsWith('"')) return JSON.parse(s)
  return s
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  return false
}
