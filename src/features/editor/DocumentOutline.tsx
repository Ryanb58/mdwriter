import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react"
import { ListBullets } from "@phosphor-icons/react"
import type { OutlineHeading } from "./documentOutline"

type OutlineContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  /** Retained headings may be displayed while refreshing, but not navigated. */
  ready: boolean
  headings: OutlineHeading[]
  active: number
  setActive: (index: number) => void
  navigate: React.RefObject<((index: number) => boolean) | null>
}
const OutlineContext = createContext<OutlineContextValue | null>(null)
export const useDocumentOutline = () => useContext(OutlineContext)

const EMPTY_HEADINGS: OutlineHeading[] = []
export const OUTLINE_DEBOUNCE_MS = 200

export function DocumentOutlineProvider({ text, children }: { text: string; children: React.ReactNode }) {
  // The Markdown parser shares the lazy editor-vendor chunk. Do not make it a
  // static dependency of EditorPane: the empty app shell must still load fast.
  const [open, setOpen] = useState(false)
  const wasOpen = useRef(false)
  const [parsed, setParsed] = useState<{ text: string; headings: OutlineHeading[] } | null>(null)
  useEffect(() => {
    const justOpened = open && !wasOpen.current
    wasOpen.current = open
    if (!open || parsed?.text === text) return

    // A dynamic import only defers loading: parsing itself is synchronous.
    // Do no parsing while closed; on opening schedule the latest snapshot for
    // the next task, and coalesce subsequent edits while retaining the list.
    let disposed = false
    const timer = window.setTimeout(() => {
      import("./documentOutline").then(({ parseOutline }) => {
        if (!disposed) setParsed({ text, headings: parseOutline(text) })
      })
    }, justOpened ? 0 : OUTLINE_DEBOUNCE_MS)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [open, text, parsed])
  const headings = parsed?.headings ?? EMPTY_HEADINGS
  const ready = parsed?.text === text
  const [active, setActive] = useState(-1)
  const navigate = useRef<((index: number) => boolean) | null>(null)
  const value = useMemo(
    () => ({ open, setOpen, ready, headings, active, setActive, navigate }),
    [open, ready, headings, active],
  )
  return <OutlineContext.Provider value={value}>{children}</OutlineContext.Provider>
}

/** An on-demand overlay, not another permanent column: the writing measure
 * stays intact in focus mode and on small windows. */
export function DocumentOutline() {
  const outline = useDocumentOutline()!
  const { open, setOpen } = outline
  const host = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent) {
      if (!host.current?.contains(event.target as Node)) setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("keydown", escape)
    }
  }, [open, setOpen])

  return (
    <div ref={host} className="relative" data-document-outline>
      <button ref={trigger} type="button" aria-label="Document outline" title="Document outline"
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-7 h-7 rounded text-text-subtle hover:text-text hover:bg-elevated focus-visible:ring-2 focus-visible:ring-accent">
        <ListBullets size={17} />
      </button>
      {open && (
        <nav id={id} aria-label="Document outline" aria-busy={!outline.ready} className="absolute right-0 top-full mt-2 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface shadow-lg">
          <div className="px-3 py-2 text-xs font-medium text-text-subtle border-b border-border">On this page</div>
          {outline.headings.length === 0 ? (
            <p className="p-3 text-xs text-text-subtle">
              {outline.ready ? "No headings yet. Add a heading to navigate this document." : "Loading outline…"}
            </p>
          ) : (
            <ol className="max-h-[min(60vh,28rem)] overflow-y-auto py-1">
              {outline.headings.map((heading, index) => (
                <li key={heading.from}>
                  <button type="button" disabled={!outline.ready}
                    aria-current={outline.ready && outline.active === index ? "location" : undefined}
                    aria-label={`Heading level ${heading.level}: ${heading.title}`}
                    title={heading.title}
                    onClick={() => {
                      if (outline.navigate.current?.(index)) {
                        outline.setActive(index)
                        setOpen(false)
                      }
                    }}
                    className={`block w-full py-1.5 pr-3 text-left text-xs truncate hover:bg-elevated disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${outline.ready && outline.active === index ? "text-accent bg-elevated font-medium" : "text-text"}`}
                    style={{ paddingLeft: 12 + heading.indent * 14 }}>
                    {heading.title}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </nav>
      )}
    </div>
  )
}
