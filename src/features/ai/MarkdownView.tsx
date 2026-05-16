import { useState, useMemo, useCallback, isValidElement, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { Check, Copy, ArrowsClockwise, Plus, Eye, FilePlus } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"
import { applyToOpenDoc, type ApplyOp } from "./applyToNote"
import { DiffModal } from "./DiffModal"
import "highlight.js/styles/github-dark.css"

/**
 * Render assistant text as markdown with GFM + syntax highlighting. Wikilinks
 * (`[[Name]]`) and bare vault-relative paths (`notes/foo.md`) become clickable
 * — they open the target file via the store.
 *
 * The renderer is intentionally permissive about the input being a partial
 * stream: react-markdown re-parses cheaply on each text change and degrades
 * gracefully on mid-token strings (an unclosed code fence renders as text).
 */
export function MarkdownView({ text }: { text: string }) {
  const preprocessed = useMemo(() => preprocessLinks(text), [text])
  const openFile = useOpenVaultFile()

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, ...rest }) => {
        const url = href ?? ""
        if (url.startsWith("mdwriter:")) {
          const target = decodeURIComponent(url.slice("mdwriter:".length))
          return (
            <button
              type="button"
              onClick={() => openFile(target)}
              className="wikilink text-accent hover:bg-accent-soft px-0.5 rounded"
              title={target}
            >
              {children}
            </button>
          )
        }
        return (
          <a href={url} target="_blank" rel="noreferrer" {...rest}>
            {children}
          </a>
        )
      },
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      code: ({ className, children, ...rest }) => (
        <code className={className} {...rest}>
          {children}
        </code>
      ),
    }),
    [openFile],
  )

  return (
    <div className="md-assistant text-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {preprocessed}
      </ReactMarkdown>
    </div>
  )
}

/**
 * Surface a callback that opens a vault file by either a wikilink "Name" or a
 * vault-relative path. Mirrors the resolution rule used in `buildPrompt`:
 * wikilinks resolve to `<root>/<name>.md` from the vault root.
 */
function useOpenVaultFile() {
  return useCallback((target: string) => {
    const state = useStore.getState()
    const root = state.rootPath
    if (!root) return
    const rel = normalizeTarget(target)
    if (!rel) return
    const full = join(root, rel)
    state.setSelected(full)
  }, [])
}

function normalizeTarget(s: string): string | null {
  const trimmed = s.trim().replace(/\\/g, "/").replace(/^\/+/, "")
  if (!trimmed) return null
  // Wikilink case: a bare name gets `.md` appended.
  if (!/\.[a-z0-9]+$/i.test(trimmed)) return `${trimmed}.md`
  return trimmed
}

function join(root: string, rel: string): string {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/"
  return root.replace(/[\\/]+$/, "") + sep + rel
}

/**
 * Turn `[[Name]]` and bare-looking markdown paths into proper links so
 * react-markdown handles them. Internal targets use a custom `mdwriter:`
 * scheme so the link renderer can dispatch to the store.
 *
 * Heuristics:
 *   - `[[Note]]` → `[Note](mdwriter:Note)`
 *   - Bare `path/to/note.md` (not inside a code span/block, not already a
 *     link) → `[path/to/note.md](mdwriter:path/to/note.md)`
 *
 * Path linking is deliberately conservative — we only touch tokens that look
 * like vault-relative markdown paths (contain a slash or end in `.md`).
 */
export function preprocessLinks(input: string): string {
  if (!input) return input

  // Pass 1: replace wikilinks, but skip anything inside fenced/inline code.
  const wikilink = /\[\[([^\]\n[]+)\]\]/g
  const out: string[] = []
  let cursor = 0

  for (const region of splitOutCode(input)) {
    if (region.code) {
      out.push(input.slice(cursor, region.end))
      cursor = region.end
      continue
    }
    const segment = input.slice(cursor, region.end)
    out.push(
      segment
        .replace(wikilink, (full: string, name: string) => {
          const clean = name.trim()
          // Whitespace-only targets (`[[   ]]`) shouldn't become empty
          // markdown links — leave the original run untouched.
          if (!clean) return full
          return `[${clean}](mdwriter:${encodeURIComponent(clean)})`
        })
        // Bare path-looking tokens — `foo/bar.md`. Skip if already inside a
        // markdown link (`](...)`) by requiring a leading boundary that isn't
        // `(` or `]`.
        .replace(/(^|[\s,(])((?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.(?:md|markdown))(?=$|[\s,.;:!?)])/g, (m, lead: string, p: string) => {
          if (lead === "(") return m
          return `${lead}[${p}](mdwriter:${encodeURIComponent(p)})`
        }),
    )
    cursor = region.end
  }

  return out.join("")
}

type Region = { end: number; code: boolean }

/**
 * Walk the string emitting alternating non-code and code regions so callers
 * can leave code spans/fences untouched.
 */
function splitOutCode(s: string): Region[] {
  const out: Region[] = []
  let i = 0
  while (i < s.length) {
    // Fenced code block — ``` or ~~~ on its own line.
    const fence = matchFence(s, i)
    if (fence) {
      out.push({ end: fence.start, code: false })
      out.push({ end: fence.end, code: true })
      i = fence.end
      continue
    }
    // Inline code — backtick run.
    const tick = s.indexOf("`", i)
    if (tick === -1) {
      out.push({ end: s.length, code: false })
      break
    }
    const run = countRun(s, tick, "`")
    const closeIdx = findClosingRun(s, tick + run, "`", run)
    if (closeIdx === -1) {
      out.push({ end: s.length, code: false })
      break
    }
    out.push({ end: tick, code: false })
    out.push({ end: closeIdx + run, code: true })
    i = closeIdx + run
  }
  return out
}

function matchFence(s: string, i: number): { start: number; end: number } | null {
  // Look for a `\n```` or `\n~~~` fence at column 0 from `i`.
  const startLineStart = i === 0 || s[i - 1] === "\n" ? i : s.indexOf("\n", i - 1) + 1
  let probe = startLineStart
  while (probe < s.length) {
    const ch = s[probe]
    if (ch === "`" || ch === "~") {
      const run = countRun(s, probe, ch)
      if (run >= 3) {
        const lineEnd = s.indexOf("\n", probe)
        const afterFence = lineEnd === -1 ? s.length : lineEnd + 1
        // Find closing fence (same char, same-or-longer run) at start of a line.
        let scan = afterFence
        while (scan < s.length) {
          const lineStart = scan
          const next = s.indexOf("\n", lineStart)
          const lineEndIdx = next === -1 ? s.length : next
          let p = lineStart
          while (p < lineEndIdx && (s[p] === " " || s[p] === "\t")) p++
          if (s[p] === ch) {
            const closeRun = countRun(s, p, ch)
            if (closeRun >= run) {
              return { start: probe, end: lineEndIdx === s.length ? s.length : lineEndIdx + 1 }
            }
          }
          if (next === -1) {
            // Unterminated fence — treat the rest of the string as code.
            return { start: probe, end: s.length }
          }
          scan = next + 1
        }
        return { start: probe, end: s.length }
      }
    }
    if (ch !== " " && ch !== "\t") break
    probe++
  }
  return null
}

function countRun(s: string, i: number, ch: string): number {
  let n = 0
  while (i + n < s.length && s[i + n] === ch) n++
  return n
}

function findClosingRun(s: string, from: number, ch: string, run: number): number {
  let i = from
  while (i < s.length) {
    if (s[i] === ch) {
      const r = countRun(s, i, ch)
      if (r === run) return i
      i += r
    } else {
      i++
    }
  }
  return -1
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const { text, language } = useMemo(() => extractCodeText(children), [children])
  const isMarkdown = language === "markdown" || language === "md"

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative my-2 group">
      <pre className="bg-elevated border border-border rounded-md overflow-x-auto text-[12px] leading-relaxed p-3 pr-9 font-mono">
        {children}
      </pre>
      {language && (
        <span className="absolute top-1.5 left-2 text-[10px] uppercase tracking-[0.14em] text-text-subtle pointer-events-none select-none">
          {language}
        </span>
      )}
      <button
        type="button"
        onClick={onCopy}
        className="absolute top-1.5 right-1.5 p-1 rounded text-text-subtle hover:text-text hover:bg-surface opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        title={copied ? "Copied" : "Copy code"}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <Check size={11} weight="bold" /> : <Copy size={11} />}
      </button>
      {isMarkdown && <ApplyToolbar markdown={text} />}
    </div>
  )
}

/**
 * Bottom toolbar attached to assistant-authored markdown blocks. Lets the
 * user merge the suggestion into their active document. The buttons are
 * disabled when there's no open doc; "Replace selection" additionally
 * requires an active selection in the editor.
 */
function ApplyToolbar({ markdown }: { markdown: string }) {
  const hasDoc = useStore((s) => s.openDoc != null)
  const hasSelection = useStore((s) => !!s.editorSelection?.text)
  const [diff, setDiff] = useState<{ op: ApplyOp; label: string } | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const run = (op: ApplyOp, label: string) => {
    const result = applyToOpenDoc(op)
    if (!result.ok) {
      setFlash(result.reason)
      setTimeout(() => setFlash(null), 2500)
      return
    }
    setFlash(`${label} ✓`)
    setTimeout(() => setFlash(null), 1500)
  }

  return (
    <>
      <div className="mt-1 flex items-center gap-1 text-[11px] text-text-subtle">
        <ApplyBtn
          icon={<ArrowsClockwise size={11} />}
          label="Replace selection"
          disabled={!hasDoc || !hasSelection}
          onClick={() => run({ kind: "replace-selection", markdown }, "Replaced selection")}
        />
        <ApplyBtn
          icon={<Plus size={11} weight="bold" />}
          label="Append"
          disabled={!hasDoc}
          onClick={() => run({ kind: "append", markdown }, "Appended")}
        />
        <ApplyBtn
          icon={<FilePlus size={11} />}
          label="Replace note"
          disabled={!hasDoc}
          onClick={() => run({ kind: "replace-all", markdown }, "Replaced note")}
        />
        <ApplyBtn
          icon={<Eye size={11} />}
          label="Diff"
          disabled={!hasDoc}
          onClick={() => setDiff({ op: { kind: "replace-all", markdown }, label: "Replace note" })}
        />
        {flash && <span className="ml-2 text-text-muted">{flash}</span>}
      </div>
      {diff && <DiffModal op={diff.op} label={diff.label} onClose={() => setDiff(null)} />}
    </>
  )
}

function ApplyBtn({
  icon, label, onClick, disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-text-subtle hover:text-text hover:bg-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

/**
 * Pull the raw code text and language hint out of a react-markdown `<pre>`
 * subtree. The subtree is always a single `<code>` whose className is
 * `language-<lang>` when GFM detects a fenced language.
 */
function extractCodeText(node: ReactNode): { text: string; language: string | null } {
  let text = ""
  let language: string | null = null

  const walk = (n: ReactNode): void => {
    if (n === null || n === undefined || typeof n === "boolean") return
    if (typeof n === "string" || typeof n === "number") {
      text += String(n)
      return
    }
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (isValidElement(n)) {
      const el = n as React.ReactElement<{ className?: string; children?: ReactNode }>
      const cls = el.props.className ?? ""
      const m = /language-([\w-]+)/.exec(cls)
      if (m && !language) language = m[1]
      walk(el.props.children)
    }
  }
  walk(node)
  // Strip the trailing newline rehype-highlight tends to add.
  return { text: text.replace(/\n$/, ""), language }
}
