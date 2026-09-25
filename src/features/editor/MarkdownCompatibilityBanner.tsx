import { useId, useState } from "react"
import { CaretDown, Warning } from "@phosphor-icons/react"
import { useStore, type OpenDoc } from "../../lib/store"
import type { DocumentIssue, DocumentRiskCode } from "../../lib/documentAnalysis"

const EXPLANATIONS: Record<DocumentRiskCode, string> = {
  "html-comment": "Comments may disappear when blocks are saved as Markdown.",
  footnote: "Footnote references and definitions may be flattened or lost.",
  "reference-definition": "Reference definitions may be dropped or rewritten as inline links.",
  "link-title": "Link and image titles may be discarded even when the destination survives.",
  mdx: "Components, expressions, and imports may become plain text or disappear.",
  "raw-html": "HTML structure and attributes may be changed or discarded.",
  "inline-html": "Inline tags and attributes may not survive conversion to blocks.",
  math: "Math delimiters or math-fence semantics may be changed or lost.",
  directive: "Directive containers and their options may not be preserved.",
  "table-alignment": "The table may remain, but column alignment may be lost.",
  "code-fence-metadata": "Code may remain, but fence attributes and metadata may be lost.",
  "multi-paragraph-quote": "Paragraph boundaries inside the quote may be flattened.",
  "ambiguous-frontmatter": "This frontmatter envelope cannot be safely separated from the body. Keep it in raw mode.",
  "frontmatter-error": "The frontmatter could not be parsed. Review the YAML in raw mode.",
}

export function MarkdownCompatibilityBanner() {
  const doc = useStore((state) => state.openDoc)
  const revision = useStore((state) => state.docRev)
  if (!doc || doc.markdownRisks.length === 0) return null
  // A different/reloaded note starts compact; edits keep the inspector open.
  return <CompatibilityInspector key={`${revision}:${doc.path}`} doc={doc} />
}

function CompatibilityInspector({ doc }: { doc: OpenDoc }) {
  const editorMode = useStore((state) => state.editorMode)
  const override = useStore((state) => state.overrideBlockModeForCurrentDoc)
  const requestMode = useStore((state) => state.requestEditorMode)
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const labels = doc.markdownRisks.map((risk) => risk.label).join(", ")

  function showSource(issue: DocumentIssue) {
    const state = useStore.getState()
    // Never navigate using coordinates from an older buffer.
    if (state.openDoc?.contentFingerprint !== doc.contentFingerprint ||
        state.openDoc.path !== doc.path) return
    state.requestEditorMode("raw")
    // CodeMirror normalizes all line endings to LF internally.
    const offset = (position: number) => doc.text.slice(0, position).replace(/\r\n?/g, "\n").length
    state.setPendingScroll({
      kind: "find-raw",
      path: doc.path,
      from: offset(issue.from),
      to: offset(issue.to),
      requestId: (state.pendingScroll?.kind === "find-raw" ? state.pendingScroll.requestId : 0) + 1,
    })
  }

  return (
    <div className="flex-none border-b border-border bg-warning/10 text-[12px] leading-relaxed text-text">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-2.5">
        <div className="flex min-w-0 flex-[1_1_18rem] items-start gap-2">
          <Warning size={15} aria-hidden="true" className="mt-0.5 flex-none text-warning" />
          <div className="min-w-0" role="status">
            <p className="font-medium">
              {editorMode === "raw"
                ? "Raw mode protects this note’s Markdown."
                : "Block mode is enabled — Markdown may change."}
            </p>
            <p className="text-text-muted">
              BlockNote may not round-trip these constructs: editing and saving in block mode can change or lose their source.
            </p>
            <p className="truncate text-text-muted" title={labels}>Detected {labels}.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={editorMode === "raw" ? override : () => requestMode("raw")}
          className="flex-none rounded border border-border-strong bg-surface px-2.5 py-1 font-medium hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {editorMode === "raw" ? "Edit in block mode anyway" : "Return to raw mode"}
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
          className="flex basis-full items-center gap-1.5 rounded text-left font-medium text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <CaretDown size={12} aria-hidden="true" className={expanded ? "rotate-180" : ""} />
          {expanded ? "Hide" : "Inspect"} compatibility details ({doc.markdownRisks.length})
        </button>
      </div>
      {expanded && (
        <section id={detailsId} aria-label="Markdown compatibility details" className="max-h-[min(18rem,40vh)] overflow-y-auto border-t border-border px-5 py-3">
          <p className="mb-3 text-[11px] text-text-muted">Select a location to view its raw source. Line numbers include frontmatter. This check is conservative, not a guarantee of lossless conversion.</p>
          <ul className="space-y-4">
            {doc.markdownRisks.map((risk) => (
              <li key={risk.code}>
                <h3 className="font-medium first-letter:uppercase">{risk.label}</h3>
                <p className="text-text-muted">{EXPLANATIONS[risk.code]}</p>
                {risk.code === "frontmatter-error" && doc.parseError && (
                  <p className="mt-1 break-words font-mono text-[11px] text-text-muted">{doc.parseError}</p>
                )}
                <ul className="mt-1.5 space-y-1">
                  {doc.markdownIssues.filter((issue) => issue.code === risk.code).map((issue) => (
                    <li key={`${issue.from}:${issue.to}`}>
                      <button
                        type="button"
                        onClick={() => showSource(issue)}
                        aria-label={`Show ${risk.label} at line ${issue.line}, column ${issue.column} in raw mode`}
                        title={`Show in raw mode: ${issue.snippet}`}
                        className="group flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded border border-border bg-surface px-2 py-1 text-left hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <span className="flex-none text-[11px] text-accent group-hover:underline">
                          {issue.endLine > issue.line ? `Lines ${issue.line}–${issue.endLine}` : `Line ${issue.line}`}, col {issue.column}
                        </span>
                        <code className="min-w-[min(100%,8rem)] flex-1 truncate whitespace-pre text-[11px]">{issue.snippet}</code>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
