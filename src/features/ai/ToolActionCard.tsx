import { useState } from "react"
import {
  CaretRight,
  CaretDown,
  CheckCircle,
  CircleNotch,
  File,
  FilePlus,
  MagnifyingGlass,
  PencilSimple,
  Terminal,
  Warning,
  Wrench,
} from "@phosphor-icons/react"
import type { ToolCall } from "../../lib/store"
import { useStore } from "../../lib/store"
import { getToolPath, numberField, stringField, truncate } from "./toolInput"

export function ToolActionCard({
  tool,
  messageIdx: _messageIdx,
}: {
  tool: ToolCall
  messageIdx: number
}) {
  const [expanded, setExpanded] = useState(false)

  const status = !tool.finished
    ? <CircleNotch size={11} className="animate-spin text-text-subtle" />
    : tool.isError
      ? <Warning size={11} weight="bold" className="text-danger" />
      : <CheckCircle size={11} weight="bold" className="text-text-subtle" />

  const summary = summarizeTool(tool)
  const Icon = summary.icon

  return (
    <div className="my-1.5 rounded-md border border-border bg-surface text-[12px]">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
      >
        {expanded
          ? <CaretDown size={10} weight="bold" className="text-text-subtle flex-none" />
          : <CaretRight size={10} weight="bold" className="text-text-subtle flex-none" />}
        <Icon size={11} className="text-text-subtle flex-none" />
        <span className="font-mono text-text">{summary.verb}</span>
        {summary.target && (
          summary.openPath ? (
            <CitationLink path={summary.openPath} label={summary.target} />
          ) : (
            <span className="font-mono text-text-muted truncate">{summary.target}</span>
          )
        )}
        {summary.detail && (
          <span className="text-text-subtle flex-none">{summary.detail}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-text-subtle flex-none">
          {status}
        </span>
      </button>
      {expanded && (
        <div className="px-2 pb-2 border-t border-border space-y-1.5 pt-1.5">
          <Section label="Input">
            <pre className="font-mono text-[11px] whitespace-pre-wrap break-all text-text-muted">
              {formatJson(tool.input)}
            </pre>
          </Section>
          {tool.finished && (
            <Section label={tool.isError ? "Error" : "Output"}>
              <pre className={`font-mono text-[11px] whitespace-pre-wrap break-all ${tool.isError ? "text-danger" : "text-text-muted"}`}>
                {formatToolOutput(tool.output)}
              </pre>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function CitationLink({ path, label }: { path: string; label: string }) {
  const setSelected = useStore((s) => s.setSelected)
  const rootPath = useStore((s) => s.rootPath)
  // The agent runs from the vault root, so tool inputs that look relative
  // are resolved against the root before opening.
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!rootPath) return
    const full = isAbsolute(path) ? path : joinPath(rootPath, path)
    setSelected(full)
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono text-text-muted hover:text-text underline decoration-dotted decoration-text-subtle hover:decoration-text truncate"
      title={`Open ${path}`}
    >
      {label}
    </button>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle mb-0.5">{label}</div>
      {children}
    </div>
  )
}

type ToolSummary = {
  /** Phosphor icon component for this tool. */
  icon: React.ComponentType<{ size?: number; className?: string }>
  /** Verb shown in monospace — "Read", "Edit", "Bash"... */
  verb: string
  /** The thing being acted on (file path, query, etc). Empty string if N/A. */
  target: string
  /** Extra small-cap detail rendered after the target. */
  detail: string
  /** When set, the target is rendered as a clickable citation that opens this path. */
  openPath: string | null
}

/**
 * Translate a Claude Code tool call into a one-line summary that's readable
 * without expanding the card. Recognises Anthropic's standard tool names —
 * unknown tools fall back to the bare tool name and no target.
 */
function summarizeTool(tool: ToolCall): ToolSummary {
  const input = (tool.input ?? {}) as Record<string, unknown>
  const name = tool.name
  const filePath = getToolPath(input)

  switch (name) {
    case "Read":
      return {
        icon: File,
        verb: "Read",
        target: filePath ?? "",
        detail: lineDetail(input, tool.output),
        openPath: filePath ?? null,
      }
    case "Edit":
    case "MultiEdit":
      return {
        icon: PencilSimple,
        verb: name === "MultiEdit" ? "MultiEdit" : "Edit",
        target: filePath ?? "",
        detail: editDetail(input),
        openPath: filePath ?? null,
      }
    case "Write":
      return {
        icon: FilePlus,
        verb: "Write",
        target: filePath ?? "",
        detail: writeDetail(input),
        openPath: filePath ?? null,
      }
    case "Glob":
      return { icon: MagnifyingGlass, verb: "Glob", target: stringField(input, "pattern") ?? "", detail: "", openPath: null }
    case "Grep":
      return { icon: MagnifyingGlass, verb: "Grep", target: stringField(input, "pattern") ?? "", detail: "", openPath: null }
    case "Bash":
      return { icon: Terminal, verb: "Bash", target: truncate(stringField(input, "command") ?? "", 60), detail: "", openPath: null }
    default:
      return { icon: Wrench, verb: name, target: "", detail: "", openPath: null }
  }
}

function lineDetail(input: Record<string, unknown>, output: unknown): string {
  const offset = numberField(input, "offset")
  const limit = numberField(input, "limit")
  if (offset != null || limit != null) {
    const from = offset ?? 1
    const count = limit ?? null
    return count != null ? `lines ${from}–${from + count - 1}` : `from line ${from}`
  }
  const text = textOf(output)
  if (text == null) return ""
  return `${text.split("\n").length} lines`
}

function editDetail(input: Record<string, unknown>): string {
  if (stringField(input, "old_string") != null && stringField(input, "new_string") != null) {
    return "1 replacement"
  }
  const edits = (input as { edits?: unknown[] }).edits
  if (Array.isArray(edits)) return `${edits.length} replacements`
  return ""
}

function writeDetail(input: Record<string, unknown>): string {
  const content = stringField(input, "content")
  if (content == null) return ""
  return `${content.split("\n").length} lines`
}

function textOf(v: unknown): string | null {
  if (typeof v === "string") return v
  if (Array.isArray(v)) {
    return v
      .map((b) => {
        if (typeof b === "string") return b
        if (b && typeof b === "object" && "text" in b) return String((b as { text: unknown }).text)
        return ""
      })
      .join("\n")
  }
  return null
}

function isAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)
}

function joinPath(root: string, rel: string): string {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/"
  return root.replace(/[\\/]+$/, "") + sep + rel.replace(/^[\\/]+/, "")
}

function formatJson(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "string") return v
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

function formatToolOutput(v: unknown): string {
  // Claude Code's tool_result content is usually a string or an array of text blocks.
  if (typeof v === "string") return v
  if (Array.isArray(v)) {
    return v
      .map((b) => {
        if (typeof b === "string") return b
        if (b && typeof b === "object" && "text" in b) return String((b as { text: unknown }).text)
        return JSON.stringify(b)
      })
      .join("\n")
  }
  return formatJson(v)
}
