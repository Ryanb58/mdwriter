import { useEffect, useRef, useState } from "react"
import { X } from "@phosphor-icons/react"
import { useFocusTrap } from "../../layout/useFocusTrap"

type Shortcut = { keys: string[]; label: string }
type Group = { title: string; shortcuts: Shortcut[] }

// Every binding here is verified against the hook that implements it —
// keep in sync when shortcuts change.
const GROUPS: Group[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["⌘", "P"], label: "Open file palette" },
      { keys: ["⌘", "⇧", "F"], label: "Search vault" },
      { keys: ["⌘", "⇧", "P"], label: "Command palette" },
      { keys: ["⌘", "K"], label: "Ask the agent" },
    ],
  },
  {
    title: "Files",
    shortcuts: [
      { keys: ["⌘", "N"], label: "New note" },
      { keys: ["F2"], label: "Rename selected file" },
      { keys: ["⌫"], label: "Move selection to Trash" },
    ],
  },
  {
    title: "Editor",
    shortcuts: [
      { keys: ["⌘", "E"], label: "Toggle block / raw markdown" },
      { keys: ["⌘", "F"], label: "Find in note" },
    ],
  },
  {
    title: "Workspace",
    shortcuts: [
      { keys: ["⌘", "L"], label: "Focus assistant" },
      { keys: ["⌘", "⇧", "↩"], label: "Focus mode" },
      { keys: ["⌘", ","], label: "Settings" },
      { keys: ["⌘", "/"], label: "This help" },
    ],
  },
]

export function ShortcutsModal() {
  const [open, setOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(cardRef, open, () => setOpen(false))

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      // ⌘/ — and ⌘? (i.e. ⌘⇧/, which most layouts report as "?").
      if (meta && !e.altKey && (e.key === "/" || e.key === "?")) {
        // CodeMirror binds Mod-/ to toggle-comment in raw mode; if the
        // editor already claimed the keystroke, yield to it.
        if (e.defaultPrevented) return
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] bg-black/45 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-[560px] max-w-[92vw] max-h-[76vh] flex flex-col rounded-xl bg-elevated border border-border-strong overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: "0 24px 48px -12px oklch(0 0 0 / 0.6), 0 4px 8px oklch(0 0 0 / 0.3)" }}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-[14px] font-semibold text-text">Keyboard shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded text-text-subtle hover:text-text hover:bg-surface transition-colors"
            aria-label="Close"
          >
            <X size={14} weight="bold" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle pb-1.5">
                {group.title}
              </div>
              <div className="space-y-1.5">
                {group.shortcuts.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-3">
                    <span className="text-[13px] text-text-muted min-w-0 truncate">{s.label}</span>
                    <span className="flex items-center gap-1 flex-none">
                      {s.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="bg-elevated border border-border rounded px-1.5 py-0.5 text-[11px] font-mono text-text-subtle"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="px-5 py-2 border-t border-border text-[11px] text-text-subtle">
          <kbd className="font-mono px-1.5 py-0.5 rounded border border-border bg-surface">⌘/</kbd> to toggle · <kbd className="font-mono px-1.5 py-0.5 rounded border border-border bg-surface">esc</kbd> to close
        </footer>
      </div>
    </div>
  )
}
