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

// Consumes the store's `pendingScroll` target once the editor is showing the
// matching doc. Deferred behind a frame so the value-sync effect above has
// updated the CM doc before we walk it for the match.
function usePendingScroll(viewRef: React.RefObject<EditorView | null>, value: string) {
  const pending = useStore((s) => s.pendingScroll)
  const setPending = useStore((s) => s.setPendingScroll)
  const openPath = useStore((s) => s.openDoc?.path ?? null)

  useEffect(() => {
    if (!pending || !openPath) return
    if (pending.path !== openPath) return
    const raf = requestAnimationFrame(() => {
      const view = viewRef.current
      if (!view) return
      const pos = scrollViewToMatch(view, pending.matchText, pending.occurrence, pending.line)
      // Wait one more frame for scrollIntoView to settle before measuring
      // the match's coordinates for the flash overlay.
      if (pos) {
        requestAnimationFrame(() => {
          const v = viewRef.current
          if (!v) return
          const start = v.coordsAtPos(pos.from)
          const end = v.coordsAtPos(pos.to)
          if (start && end) {
            flashHighlight({
              left: Math.min(start.left, end.left),
              top: Math.min(start.top, end.top),
              width: Math.max(end.right - start.left, 0),
              height: Math.max(start.bottom - start.top, 0),
            })
          }
        })
      }
      setPending(null)
    })
    return () => cancelAnimationFrame(raf)
    // `value` is in deps because the editor's content may update after the
    // pending target was set (file load), and we want to re-evaluate once it
    // matches.
  }, [pending, openPath, value, viewRef, setPending])
}
