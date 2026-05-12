import { useEffect, useMemo, useRef, useState } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { useRawImagePaste } from "./useRawImagePaste"
import { useLinkActivation } from "./useLinkActivation"
import { useVaultNotes } from "../../lib/vaultNotes"
import { useStore } from "../../lib/store"
import { scrollViewToMatch } from "./scrollViewToMatch"
import { flashHighlight } from "./flashHighlight"
import {
  decorateLinks,
  rebuildLinkDecorations,
  wikilinkCompletion,
  type WikilinkCompletionState,
} from "./wikilinkCM"
import { RawWikilinkPopup } from "./RawWikilinkPopup"

export function RawEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [trigger, setTrigger] = useState<WikilinkCompletionState | null>(null)
  const notes = useVaultNotes()
  // Hold the live note list in a ref so the CM decoration callback —
  // which lives outside React and doesn't re-run on prop changes — can
  // always reach the current vault when resolving links.
  const notesRef = useRef(notes)
  notesRef.current = notes

  // `wikilinkCompletion` returns both the extension and a `dismiss()`
  // entrypoint the popup calls on Esc; build them once per editor mount.
  const completion = useMemo(
    () => wikilinkCompletion((s) => setTrigger(s)),
    [],
  )

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          lineNumbers(),
          markdown(),
          decorateLinks(() => notesRef.current),
          completion.extension,
          EditorView.theme({ "&": { height: "100%" } }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  }, [])

  // sync external value changes (e.g. file switch)
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    if (v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    }
  }, [value])

  // Whenever the vault note list changes, ask the decoration plugin to
  // recompute so resolved↔broken styling stays accurate without a doc
  // edit. The ref above keeps the resolver's view of `notes` fresh too.
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    v.dispatch({ effects: rebuildLinkDecorations.of() })
  }, [notes])

  useRawImagePaste(viewRef)
  useLinkActivation(hostRef)
  usePendingScroll(viewRef, value)

  return (
    <>
      <div ref={hostRef} className="h-full overflow-auto" />
      <RawWikilinkPopup
        state={trigger}
        notes={notes}
        viewRef={viewRef}
        onDismiss={completion.dismiss}
      />
    </>
  )
}

function findLineElement(view: EditorView, pos: number): HTMLElement | null {
  let n: Node | null = view.domAtPos(pos).node
  while (n) {
    if (n instanceof HTMLElement && n.classList.contains("cm-line")) return n
    n = n.parentNode
  }
  return null
}

function usePendingScroll(viewRef: React.RefObject<EditorView | null>, value: string) {
  const pending = useStore((s) => s.pendingScroll)
  const setPending = useStore((s) => s.setPendingScroll)
  const openPath = useStore((s) => s.openDoc?.path ?? null)

  useEffect(() => {
    if (!pending || !openPath || pending.path !== openPath) return
    // Defer a frame so the value-sync effect upstream has applied the new
    // file's content before we walk the doc for the match.
    const raf = requestAnimationFrame(() => {
      const view = viewRef.current
      if (!view) return
      const pos = scrollViewToMatch(view, pending.matchText, pending.occurrence, pending.line)
      if (pos) {
        requestAnimationFrame(() => {
          const v = viewRef.current
          if (!v) return
          flashHighlight(findLineElement(v, pos.from))
        })
      }
      setPending(null)
    })
    return () => cancelAnimationFrame(raf)
  }, [pending, openPath, value, viewRef, setPending])
}
