import { useEffect, useRef, useState } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { useRawImagePaste } from "./useRawImagePaste"
import { useLinkActivation } from "./useLinkActivation"
import { useVaultNotes } from "../../lib/vaultNotes"
import { decorateLinks, wikilinkCompletion, type WikilinkCompletionState } from "./wikilinkCM"
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
          decorateLinks,
          wikilinkCompletion((s) => setTrigger(s)),
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

  useRawImagePaste(viewRef)
  useLinkActivation(hostRef)

  return (
    <>
      <div ref={hostRef} className="h-full overflow-auto" />
      <RawWikilinkPopup state={trigger} notes={notes} viewRef={viewRef} />
    </>
  )
}
