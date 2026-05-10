import { useState } from "react"
import { useStore } from "../../lib/store"
import { PropertyField } from "./PropertyField"
import { Plus } from "@phosphor-icons/react"

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

  const entries = Object.entries(doc.frontmatter)

  function setField(k: string, v: unknown) {
    patch({ frontmatter: { ...doc!.frontmatter, [k]: v }, dirty: true })
  }
  function removeField(k: string) {
    const next = { ...doc!.frontmatter }
    delete next[k]
    patch({ frontmatter: next, dirty: true })
  }
  function addField() {
    const name = draftName.trim()
    if (!name) { setAdding(false); return }
    if (name in doc!.frontmatter) { setAdding(false); setDraftName(""); return }
    patch({ frontmatter: { ...doc!.frontmatter, [name]: "" }, dirty: true })
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
