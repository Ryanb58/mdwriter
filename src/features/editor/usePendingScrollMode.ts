import { useEffect } from "react"
import { useStore } from "../../lib/store"
import { useEditorMode } from "./useEditorMode"

/**
 * Bridges a `pendingScroll` (set by features like vault search) to a raw-mode
 * editor that can actually show a specific line. Block view has no concept of
 * file lines, so when the pending target matches the open doc we toggle to raw
 * — RawEditor then consumes `pendingScroll` and scrolls to it.
 */
export function usePendingScrollMode() {
  const pending = useStore((s) => s.pendingScroll)
  const openPath = useStore((s) => s.openDoc?.path ?? null)
  const mode = useStore((s) => s.editorMode)
  const { toggle } = useEditorMode()

  useEffect(() => {
    if (!pending || !openPath) return
    if (pending.path !== openPath) return
    if (mode === "raw") return
    // useEditorMode.toggle reads the latest store state, so it'll combineRaw
    // the body+frontmatter correctly before flipping to raw.
    void toggle()
    // We intentionally don't depend on `toggle` — its identity changes every
    // render and we only care about the current store snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, openPath, mode])
}
