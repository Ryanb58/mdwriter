import { useEffect } from "react"
import { useStore } from "../../lib/store"
import { combineRaw } from "../../lib/yaml"

export function useEditorMode() {
  const mode = useStore((s) => s.editorMode)
  const setMode = useStore((s) => s.setEditorMode)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === "e") {
        e.preventDefault()
        toggle()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  })

  async function toggle() {
    const doc = useStore.getState().openDoc
    if (!doc) return
    if (mode === "block") {
      // Going to raw: produce combined source from current frontmatter + body.
      const raw = combineRaw(doc.frontmatter, doc.rawMarkdown)
      useStore.getState().patchOpenDoc({ rawMarkdown: raw })
      setMode("raw")
    } else {
      // Going back to block: re-parse via local simple YAML parser.
      try {
        const parsed = parseRaw(doc.rawMarkdown)
        useStore.getState().patchOpenDoc({
          frontmatter: parsed.frontmatter,
          rawMarkdown: parsed.body,
          parseError: null,
        })
        setMode("block")
      } catch (e) {
        useStore.getState().patchOpenDoc({ parseError: String(e) })
      }
    }
  }
}

function parseRaw(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { frontmatter: {}, body: raw }
  const yaml = m[1]
  const fm = parseSimpleYaml(yaml)
  return { frontmatter: fm, body: raw.slice(m[0].length).replace(/^\n+/, "") }
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const lines = yaml.split("\n")
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const kv = line.match(/^(\S+):\s*(.*)$/)
    if (!kv) { i++; continue }
    const [, key, value] = kv
    if (value === "") {
      const items: unknown[] = []
      i++
      while (i < lines.length && /^\s+- /.test(lines[i])) {
        items.push(parseScalar(lines[i].replace(/^\s+- /, "")))
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
