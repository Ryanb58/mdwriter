import { useState } from "react"
import { ShieldCheck, ShieldWarning, X } from "@phosphor-icons/react"
import { ipc } from "../../lib/ipc"
import { useStore, type PendingPermission } from "../../lib/store"
import { getToolPath, pathPrefixForAllowlist, stringField, truncate } from "./toolInput"

/**
 * Inline approval card shown when the agent has paused mid-turn waiting
 * for permission to call a tool. The card is the only way the agent can
 * proceed: clicking Allow / Allow for session resumes the same turn,
 * clicking Deny tells the agent to recover and move on.
 *
 * "Allow for session" extends the broker's in-memory allowlist via
 * `addPermissionRule` so subsequent matching tool calls resolve without
 * a card. Scope is `(tool, path-prefix)` when the input is path-shaped,
 * otherwise `(tool, *)`. The session ends when the subprocess exits or
 * the user cancels — there's no on-disk persistence yet.
 */
export function PermissionApprovalCard({ pending }: { pending: PendingPermission }) {
  const resolve = useStore((s) => s.resolvePendingPermission)
  const [busy, setBusy] = useState(false)

  const summary = summarizePending(pending)
  const allowForSessionScope = sessionScope(pending)

  async function decide(decision: "allow" | "deny", opts?: { sessionAllowlist?: boolean }) {
    if (busy) return
    setBusy(true)
    try {
      if (decision === "allow" && opts?.sessionAllowlist && allowForSessionScope) {
        // Order matters: add the rule before responding so a tight
        // burst of follow-up tool calls from the agent finds the rule
        // already in place when the broker checks it.
        await ipc.addPermissionRule(allowForSessionScope.tool, allowForSessionScope.pathPrefix)
      }
      await ipc.respondPermission(pending.id, decision)
    } finally {
      resolve(pending.id)
    }
  }

  return (
    <div className="my-1.5 rounded-md border border-warning/40 bg-warning/5 text-[12px]">
      <div className="flex items-start gap-2 px-2.5 py-2">
        <ShieldWarning size={14} weight="bold" className="text-warning flex-none mt-[1px]" />
        <div className="flex-1 min-w-0">
          <div className="text-text font-medium leading-snug">
            Approve {summary.verb}
            {summary.target && (
              <span className="font-mono text-text-muted ml-1.5">{summary.target}</span>
            )}
            ?
          </div>
          {summary.detail && (
            <div className="text-text-subtle text-[11.5px] mt-0.5 leading-snug truncate">
              {summary.detail}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-0">
        <button
          type="button"
          onClick={() => decide("allow")}
          disabled={busy}
          className="text-[11.5px] px-2.5 py-1 rounded bg-warning/15 text-warning hover:bg-warning/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-1.5"
        >
          <ShieldCheck size={11} weight="bold" />
          Allow once
        </button>
        {allowForSessionScope && (
          <button
            type="button"
            onClick={() => decide("allow", { sessionAllowlist: true })}
            disabled={busy}
            className="text-[11.5px] px-2.5 py-1 rounded border border-warning/30 text-warning hover:bg-warning/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={
              allowForSessionScope.pathPrefix
                ? `Allow ${allowForSessionScope.tool} on anything under ${allowForSessionScope.pathPrefix} for the rest of this session.`
                : `Allow ${allowForSessionScope.tool} for the rest of this session.`
            }
          >
            Allow for session
          </button>
        )}
        <button
          type="button"
          onClick={() => decide("deny")}
          disabled={busy}
          className="ml-auto text-[11.5px] px-2.5 py-1 rounded text-text-subtle hover:text-text hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          <X size={11} weight="bold" />
          Deny
        </button>
      </div>
    </div>
  )
}

type ApprovalSummary = {
  verb: string
  target: string
  detail: string
}

function summarizePending(p: PendingPermission): ApprovalSummary {
  const input = (p.input ?? {}) as Record<string, unknown>
  switch (p.tool) {
    case "Edit":
    case "MultiEdit":
      return {
        verb: p.tool === "MultiEdit" ? "edits to" : "an edit to",
        target: getToolPath(input) ?? "",
        detail: "",
      }
    case "Write":
      return { verb: "writing", target: getToolPath(input) ?? "", detail: "" }
    case "Bash":
      return {
        verb: "running",
        target: "",
        detail: truncate(stringField(input, "command") ?? "", 120),
      }
    case "Read":
      return { verb: "reading", target: getToolPath(input) ?? "", detail: "" }
    default:
      return { verb: `the ${p.tool} call`, target: "", detail: summarizeInput(input) }
  }
}

function sessionScope(p: PendingPermission): { tool: string; pathPrefix: string | null } | null {
  const input = (p.input ?? {}) as Record<string, unknown>
  const filePath = getToolPath(input)
  if (filePath) return { tool: p.tool, pathPrefix: pathPrefixForAllowlist(filePath) }
  // No path-shaped input → don't blanket per-session for tools where
  // every invocation is meaningfully different (e.g. Bash).
  if (p.tool === "Bash") return null
  return { tool: p.tool, pathPrefix: null }
}

function summarizeInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input)
  if (keys.length === 0) return ""
  const first = keys[0]
  const v = input[first]
  if (typeof v === "string") return `${first}: ${truncate(v, 80)}`
  return `${first}: ${truncate(JSON.stringify(v), 80)}`
}
