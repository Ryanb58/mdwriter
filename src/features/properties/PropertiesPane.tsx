import { useState } from "react"
import { useStore } from "../../lib/store"
import { PropertyField } from "./PropertyField"

export function PropertiesPane() {
  const doc = useStore((s) => s.openDoc)
  const patch = useStore((s) => s.patchOpenDoc)
  const mode = useStore((s) => s.editorMode)
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState("")

  if (!doc) return <div className="p-3 text-xs opacity-50">No file selected.</div>
  if (mode === "raw") return (
    <div className="p-3 text-xs opacity-50 italic">
      Editing raw source — properties update on switch back.
    </div>
  )

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
    <div className="p-3 text-sm">
      <div className="text-xs uppercase opacity-50 mb-2">Properties</div>
      {entries.length === 0 && !adding && <div className="text-xs opacity-50 italic">No frontmatter.</div>}
      {entries.map(([k, v]) => (
        <PropertyField key={k} name={k} value={v} onChange={(nv) => setField(k, nv)} onRemove={() => removeField(k)} />
      ))}
      {adding ? (
        <div className="mt-2">
          <input
            autoFocus
            value={draftName}
            placeholder="Field name…"
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addField()
              if (e.key === "Escape") { setAdding(false); setDraftName("") }
            }}
            onBlur={addField}
            className="w-full bg-transparent border-b border-blue-500 outline-none px-1 py-0.5 text-sm"
          />
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-2 text-xs opacity-60 hover:opacity-100">+ Add field</button>
      )}
    </div>
  )
}
