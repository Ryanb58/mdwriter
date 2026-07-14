import { useState } from "react"
import { useStore } from "../../lib/store"
import { PropertyField } from "./PropertyField"
import { Plus, Warning, X } from "@phosphor-icons/react"
import {
  getFrontmatterValues,
  setFrontmatterField,
  renameFrontmatterField,
  removeFrontmatterField,
} from "../../lib/doc"

/**
 * Frontmatter editor for the currently open file, hosted in the right pane
 * (tabbed alongside the Assistant). Reads the YAML region of the canonical
 * text directly and rewrites it on every change — the on-disk text is the
 * source of truth, so external edits (watcher, AI apply) show up without a
 * separate sync step.
 */
export function PropertiesPane() {
  const doc = useStore((s) => s.openDoc)
  const editOpenDoc = useStore((s) => s.editOpenDoc)
  const mode = useStore((s) => s.editorMode)
  const [adding, setAdding] = useState(false)

  if (!doc) {
    return <PaneNotice>No file open.</PaneNotice>
  }
  if (doc.parseError) {
    return (
      <div className="px-4 py-4">
        <div className="flex items-start gap-2 rounded-md bg-danger/10 text-danger px-3 py-2.5 text-[12px] leading-relaxed">
          <Warning size={14} className="flex-none mt-0.5" />
          <div className="min-w-0">
            Couldn&apos;t parse this file&apos;s frontmatter. Fix it in raw mode
            (<span className="font-mono">⌘E</span>).
          </div>
        </div>
      </div>
    )
  }
  if (mode === "raw") {
    return (
      <PaneNotice>
        Editing raw source. The YAML is right there in the document — these
        fields refresh when you switch back to block view.
      </PaneNotice>
    )
  }

  const values = getFrontmatterValues(doc.text)
  const entries = Object.entries(values)

  function applyText(nextText: string) {
    editOpenDoc(nextText)
  }
  function setField(k: string, v: unknown) {
    applyText(setFrontmatterField(doc!.text, k, v))
  }
  function renameField(oldKey: string, newKey: string) {
    applyText(renameFrontmatterField(doc!.text, oldKey, newKey))
  }
  function removeField(k: string) {
    applyText(removeFrontmatterField(doc!.text, k))
  }
  function addField(name: string, value: string) {
    const trimmed = name.trim()
    if (trimmed && !(trimmed in values)) {
      applyText(setFrontmatterField(doc!.text, trimmed, value))
    }
    setAdding(false)
  }

  return (
    <div className="px-4 py-4">
      <div className="space-y-2">
        {entries.length === 0 && !adding && (
          <p className="text-[12px] text-text-subtle leading-relaxed">
            No properties yet. Add fields like tags, status, or a date to
            organize this note.
          </p>
        )}
        {entries.map(([k, v]) => (
          <PropertyField
            key={k}
            name={k}
            value={v}
            onChange={(nv) => setField(k, nv)}
            onRename={(next) => renameField(k, next)}
            onRemove={() => removeField(k)}
          />
        ))}
        {adding && (
          <DraftField existing={values} onCommit={addField} onCancel={() => setAdding(false)} />
        )}
      </div>
      <div className="mt-3">
        {!adding && (
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

/**
 * A new, unsaved property row — a name field and a value field laid out like a
 * real property. Commits (writes `name: value` to the frontmatter) when focus
 * leaves the row or Enter is pressed; Escape or the cancel button discards it.
 * An empty or duplicate name commits to nothing.
 */
function DraftField({
  existing, onCommit, onCancel,
}: {
  existing: Record<string, unknown>
  onCommit: (name: string, value: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState("")
  const [value, setValue] = useState("")
  const duplicate = name.trim() !== "" && name.trim() in existing

  function commit() {
    onCommit(name, value)
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); commit() }
    if (e.key === "Escape") { e.preventDefault(); onCancel() }
  }
  // Commit only when focus leaves the row entirely — tabbing between the name
  // and value fields keeps the draft open.
  function onBlurRow(e: React.FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    commit()
  }

  return (
    <div onBlur={onBlurRow} className="grid grid-cols-[minmax(72px,34%)_1fr_auto] items-center gap-2">
      <input
        autoFocus
        value={name}
        placeholder="Name"
        aria-label="New property name"
        aria-invalid={duplicate}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        className={[
          "min-w-0 text-[12px] font-medium text-text bg-elevated border rounded px-1.5 py-1",
          "placeholder:text-text-subtle placeholder:font-normal focus-visible:outline-none focus-visible:ring-1",
          duplicate ? "border-danger focus-visible:ring-danger" : "border-border-strong focus-visible:ring-accent",
        ].join(" ")}
      />
      <input
        value={value}
        placeholder="Value"
        aria-label="New property value"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        className="w-full text-[13px] bg-elevated rounded px-1.5 py-1 placeholder:text-text-subtle focus:ring-1 focus:ring-accent-soft transition-colors"
      />
      <button
        type="button"
        // Prevent the row's blur-commit from firing before the click cancels.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCancel}
        title="Cancel"
        aria-label="Cancel new property"
        className="text-text-subtle hover:text-danger transition-colors p-1 -m-1 rounded"
      >
        <X size={11} weight="bold" />
      </button>
    </div>
  )
}

function PaneNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-4 text-[12px] text-text-subtle leading-relaxed">
      {children}
    </div>
  )
}
