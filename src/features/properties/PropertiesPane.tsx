import { useState } from "react"
import { useStore } from "../../lib/store"
import { PropertyField } from "./PropertyField"
import { Plus } from "@phosphor-icons/react"
import {
  getFrontmatterValues,
  setFrontmatterField,
  removeFrontmatterField,
} from "../../lib/doc"

export function PropertiesPane() {
  const doc = useStore((s) => s.openDoc)
  const patch = useStore((s) => s.patchOpenDoc)
  const mode = useStore((s) => s.editorMode)
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState("")

  if (!doc) {
    return (
      <div className="p-5 text-[12px] text-text-subtle">No file selected.</div>
    )
  }

  if (mode === "raw") {
    return (
      <div className="p-5 text-[12px] text-text-subtle leading-relaxed">
        Editing raw source.<br />Properties refresh on switch back.
      </div>
    )
  }

  // Read directly from the canonical text. The legacy `doc.frontmatter`
  // object is mirrored only — we no longer treat it as the source of
  // truth.
  const values = getFrontmatterValues(doc.text)
  const entries = Object.entries(values)

  function applyText(nextText: string) {
    // Mirror to the legacy fields so the autosave path (which still
    // reads frontmatter + rawMarkdown through Phase 6) writes the
    // updated frontmatter and the same body it had.
    patch({
      text: nextText,
      frontmatter: getFrontmatterValues(nextText),
      dirty: true,
    })
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
    <div className="px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.14em] text-text-subtle mb-3">Properties</div>
      <div className="space-y-2">
        {entries.length === 0 && !adding && (
          <div className="text-[12px] text-text-subtle">No fields yet.</div>
        )}
        {entries.map(([k, v]) => (
          <PropertyField key={k} name={k} value={v} onChange={(nv) => setField(k, nv)} onRemove={() => removeField(k)} />
        ))}
      </div>
      <div className="mt-3">
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
            className="w-full text-[13px] bg-elevated border border-border-strong rounded-md px-2 py-1.5 placeholder:text-text-subtle"
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
  )
}
