import { useState } from "react"
import { useStore } from "../../lib/store"
import { PropertyField } from "./PropertyField"
import { CaretRight, Plus } from "@phosphor-icons/react"
import {
  getFrontmatterValues,
  setFrontmatterField,
  removeFrontmatterField,
} from "../../lib/doc"

/**
 * Collapsible frontmatter section rendered inside the editor pane, above the
 * document body (the Obsidian/Bear pattern). Replaces the old right-pane
 * properties tab — metadata belongs with the document it describes.
 *
 * Hidden in raw mode: the raw editor shows the YAML itself.
 */
export function PropertiesSection() {
  const doc = useStore((s) => s.openDoc)
  const mode = useStore((s) => s.editorMode)
  const expanded = useStore((s) => s.propertiesExpanded)
  const setExpanded = useStore((s) => s.setPropertiesExpanded)
  const patch = useStore((s) => s.patchOpenDoc)
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState("")

  if (!doc || mode === "raw" || doc.parseError) return null

  // Read directly from the canonical text. The on-disk YAML is the
  // source of truth; we re-parse it on every render so external edits
  // (file watcher, AI apply) are reflected without a separate sync step.
  const values = getFrontmatterValues(doc.text)
  const entries = Object.entries(values)

  function applyText(nextText: string) {
    patch({ text: nextText, dirty: true })
  }
  function setField(k: string, v: unknown) {
    applyText(setFrontmatterField(doc!.text, k, v))
  }
  function removeField(k: string) {
    applyText(removeFrontmatterField(doc!.text, k))
  }
  function addField() {
    const name = draftName.trim()
    if (!name) { setAdding(false); return }
    if (name in values) { setAdding(false); setDraftName(""); return }
    applyText(setFrontmatterField(doc!.text, name, ""))
    setAdding(false)
    setDraftName("")
  }

  return (
    <div className="border-b border-border px-5 flex-none">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 py-2 text-[11px] uppercase tracking-[0.14em] text-text-subtle hover:text-text transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-sm"
      >
        <CaretRight
          size={10}
          weight="bold"
          className={["transition-transform duration-150", expanded ? "rotate-90" : ""].join(" ")}
        />
        Properties
        {entries.length > 0 && <span className="normal-case tracking-normal">({entries.length})</span>}
      </button>
      {expanded && (
        <div className="pb-3 max-w-2xl">
          <div className="space-y-2">
            {entries.map(([k, v]) => (
              <PropertyField
                key={k}
                name={k}
                value={v}
                onChange={(nv) => setField(k, nv)}
                onRemove={() => removeField(k)}
              />
            ))}
          </div>
          <div className={entries.length > 0 ? "mt-2.5" : ""}>
            {adding ? (
              <input
                autoFocus
                value={draftName}
                placeholder="Field name"
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addField()
                  if (e.key === "Escape") { setAdding(false); setDraftName("") }
                }}
                onBlur={addField}
                className="w-full text-[13px] bg-elevated border border-border-strong rounded-md px-2 py-1.5 placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 text-[12px] text-text-subtle hover:text-text transition-colors"
              >
                <Plus size={12} weight="bold" /> Add field
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
