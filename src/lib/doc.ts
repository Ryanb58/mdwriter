/**
 * Pure helpers over the canonical document text. `text` is the full file
 * contents — frontmatter (if any) is a `[start, end)` byte slice; everything
 * after is the body. All mutations are string → string; no state.
 *
 * Invariants (the whole point of this module):
 *
 * 1. Body bytes are preserved verbatim when only frontmatter is mutated.
 *    `setBody` / `removeFrontmatterField` / `setFrontmatterField` never
 *    rewrite or trim the body region.
 *
 * 2. Frontmatter bytes are preserved verbatim when only the body changes.
 *    `setBody` splices text after the frontmatter region; the YAML bytes
 *    are untouched.
 *
 * 3. YAML lines that the simple parser can't model (multiline nested
 *    mappings, anchors, flow-style maps) survive `setFrontmatterField`
 *    on a *different* key. The mutation is line-targeted: we find the
 *    affected key's line in the original YAML text and splice only those
 *    bytes. Unrelated lines pass through untouched.
 */

export type ParsedDoc = {
  /** `[start, end)` of the entire frontmatter region (fences + separator)
   *  or `null` if absent. */
  frontmatterRange: { start: number; end: number } | null
  /** Parsed scalar/array values from the YAML region. Empty when no FM.
   *  Lines our simple parser can't model are silently skipped — see the
   *  splice-based mutators for how they're preserved on edit. */
  values: Record<string, unknown>
  /** The body slice — equal to `text.slice(frontmatterRange?.end ?? 0)`. */
  body: string
  /** YAML parse error (if any). Reserved for catastrophic failures; the
   *  lenient parser does not flip this for individual unparseable lines. */
  parseError: string | null
}

// Open with `---\n`, capture YAML up to a closing `---` on its own line,
// then optionally consume the single trailing newline after the closing
// fence. Lazy quantifier so the shortest valid match wins.
const FM_RE = /^---\n([\s\S]*?\n)---(?:\r?\n)?/

// Byte offset of the YAML content within the matched FM region. The regex
// always starts with `---\n` so the YAML payload always begins at position 4.
const YAML_CONTENT_START = 4

export function parseDoc(text: string): ParsedDoc {
  const m = text.match(FM_RE)
  if (!m) return { frontmatterRange: null, values: {}, body: text, parseError: null }
  const matchEnd = m[0].length
  let values: Record<string, unknown> = {}
  let parseError: string | null = null
  try {
    values = parseSimpleYaml(m[1])
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
  // No-op when the new value structurally equals the existing one. Lets
  // callers patch on every keystroke without churning bytes.
  if (key in r.values && deepEqual(r.values[key], value)) return text

  if (!r.frontmatterRange) {
    // No FM yet — prepend a canonical block with just this key. The
    // original text becomes the body verbatim.
    const yaml = formatYamlKv(key, value)
    return `---\n${yaml}\n---\n\n${text}`
  }

  return spliceYamlKey(text, key, formatYamlKv(key, value))
}

export function removeFrontmatterField(text: string, key: string): string {
  const r = parseDoc(text)
  if (!r.frontmatterRange) return text
  if (!(key in r.values)) return text

  const next = spliceYamlKey(text, key, null)
  // If the splice left an empty YAML region (`---\n\s*---\n…`), drop the
  // whole frontmatter block so the file reads as "no frontmatter" again.
  // Comments / non-whitespace YAML are preserved (the match below requires
  // pure whitespace between fences).
  const degenerate = next.match(/^---\n[ \t\n]*---(?:\r?\n)?\n?/)
  if (degenerate) return next.slice(degenerate[0].length)
  return next
}

/**
 * Replace (or remove, when `replacement` is `null`) the YAML line(s)
 * belonging to `key` in `text`'s frontmatter region. The lines outside
 * `key`'s span — including any YAML our simple parser couldn't model —
 * are preserved byte-for-byte. The body region is never touched.
 *
 * "Lines belonging to `key`" means the `key: …` line plus any indented
 * continuation lines that immediately follow (bullet items, sub-mappings).
 * If `key` isn't present in the original YAML text, `replacement` is
 * appended just before the closing fence.
 */
function spliceYamlKey(text: string, key: string, replacement: string | null): string {
  const m = text.match(FM_RE)
  if (!m) return text
  const yamlSrc = m[1] // includes the trailing newline before the closing `---`
  // Split into lines. yamlSrc always ends with "\n" so the last element is "".
  const lines = yamlSrc.split("\n")

  const keyIdx = findKeyLine(lines, key)

  let updated: string[]
  if (keyIdx === -1) {
    if (replacement === null) return text
    // Append before the trailing empty element so we keep yamlSrc's "\n" suffix.
    updated = [...lines.slice(0, -1), ...replacement.split("\n"), ""]
  } else {
    let endIdx = keyIdx + 1
    // Consume indented continuation (bullet items, nested mappings).
    while (endIdx < lines.length && /^\s+\S/.test(lines[endIdx])) endIdx++
    if (replacement === null) {
      updated = [...lines.slice(0, keyIdx), ...lines.slice(endIdx)]
    } else {
      updated = [
        ...lines.slice(0, keyIdx),
        ...replacement.split("\n"),
        ...lines.slice(endIdx),
      ]
    }
  }

  const newYamlSrc = updated.join("\n")
  return text.slice(0, YAML_CONTENT_START) + newYamlSrc + text.slice(YAML_CONTENT_START + yamlSrc.length)
}

function findKeyLine(lines: string[], key: string): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Match `key:` at start, optionally followed by space/value, OR a
    // bare `key:` line that introduces a block. Avoid false-positive
    // prefix matches (e.g. `key` matching `keyword:`).
    if (line.startsWith(`${key}:`) && (line.length === key.length + 1 || /\s/.test(line[key.length + 1]))) {
      return i
    }
  }
  return -1
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
// indented continuation of a multiline mapping) are skipped rather
// than throwing. The values map is best-effort; the splice mutators
// above preserve the raw bytes of any line we can't model so the
// on-disk YAML survives mutations of other keys.
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
      // Block scalar / nested mapping / bullet list. We only model bullet
      // lists ("  - item"); for anything else we leave the key absent
      // from `values` so the splice mutators won't try to rewrite it.
      const itemStart = i + 1
      let j = itemStart
      const items: unknown[] = []
      while (j < lines.length && /^\s+-\s/.test(lines[j])) {
        items.push(parseScalar(lines[j].replace(/^\s+-\s/, "")))
        j++
      }
      // Decide based on whether we actually consumed bullet items: if we
      // did, it's a list. If we didn't and the next lines are indented
      // continuation (a nested mapping), skip them — don't record an
      // empty array for the key.
      if (items.length > 0) {
        out[key] = items
        i = j
        continue
      }
      // Skip any indented continuation lines so they don't get
      // mis-parsed as siblings of the outer block.
      let k = i + 1
      while (k < lines.length && /^\s+\S/.test(lines[k])) k++
      // Don't add `key` to `out` — the value shape is something we don't
      // model, so leave it untouched on edits via the splice path.
      i = k
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
