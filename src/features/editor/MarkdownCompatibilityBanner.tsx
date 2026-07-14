import { Warning } from "@phosphor-icons/react"
import { useStore } from "../../lib/store"

export function MarkdownCompatibilityBanner() {
  const risks = useStore((state) => state.openDoc?.markdownRisks ?? [])
  const editorMode = useStore((state) => state.editorMode)
  const override = useStore((state) => state.overrideBlockModeForCurrentDoc)

  if (risks.length === 0) return null

  return (
    <div
      role="status"
      className="flex items-start justify-between gap-4 border-b border-border bg-warning/10 px-5 py-2.5 text-text"
    >
      <div className="flex min-w-0 items-start gap-2">
        <Warning size={15} className="mt-0.5 flex-none text-warning" />
        <div className="min-w-0 text-[12px] leading-relaxed">
          <div className="font-medium">Raw mode protects this note&apos;s Markdown.</div>
          <div className="text-text-subtle">
            Detected {risks.map((risk) => risk.label).join(", ")}.
          </div>
        </div>
      </div>
      {editorMode === "raw" && (
        <button
          type="button"
          onClick={override}
          className="flex-none rounded border border-border-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-text hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Edit in block mode anyway
        </button>
      )}
    </div>
  )
}
