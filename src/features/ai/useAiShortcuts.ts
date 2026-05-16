import { useEffect } from "react"
import { useStore } from "../../lib/store"
import { openPanel } from "../../layout/layoutControl"

/**
 * Cmd/Ctrl+L → reveal the AI panel and focus the composer. Mirrors common
 * AI-coding-tool muscle memory (Cursor, Continue, etc).
 *
 * The shortcut is no-op when an input/textarea/contenteditable already has
 * focus — those should keep their normal `L` behaviour. The exception is the
 * composer itself, where re-pressing the shortcut is a noop because focus is
 * already where it should be.
 */
export function useAiShortcuts() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (!meta || e.shiftKey || e.altKey) return
      if (e.key.toLowerCase() !== "l") return

      const target = e.target as HTMLElement | null
      // Allow the shortcut inside the AI composer (re-focus is fine) but block
      // it inside normal editor inputs so typed Ls work.
      const isInComposer = target?.closest?.("[data-mdwriter-ai-composer]") != null
      const isInEditableElsewhere =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true
      if (isInEditableElsewhere && !isInComposer) return

      e.preventDefault()
      useStore.getState().setRightPaneTab("ai")
      openPanel("right")
      // Defer focus until the panel has had a render to mount the composer.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLTextAreaElement>("[data-mdwriter-ai-composer] textarea")
        el?.focus()
      })
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])
}
