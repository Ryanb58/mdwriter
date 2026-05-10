import { useState } from "react"
import { CaretRight, CaretDown, Wrench, CheckCircle, Warning, CircleNotch } from "@phosphor-icons/react"
import type { ToolCall } from "../../lib/store"

export function ToolActionCard({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false)

  const status = !tool.finished
    ? <CircleNotch size={11} className="animate-spin text-text-subtle" />
    : tool.isError
      ? <Warning size={11} weight="bold" className="text-danger" />
      : <CheckCircle size={11} weight="bold" className="text-text-subtle" />

  return (
    <div className="my-1.5 rounded-md border border-border bg-surface text-[12px]">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
      >
        {expanded
          ? <CaretDown size={10} weight="bold" className="text-text-subtle flex-none" />
          : <CaretRight size={10} weight="bold" className="text-text-subtle flex-none" />}
        <Wrench size={11} className="text-text-subtle flex-none" />
        <span className="font-mono text-text">{tool.name}</span>
        <span className="ml-auto flex items-center gap-1.5 text-text-subtle">
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle mb-0.5">{label}</div>
      {children}
    </div>
  )
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
