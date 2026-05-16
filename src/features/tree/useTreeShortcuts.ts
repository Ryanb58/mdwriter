import { useEffect } from "react"
import { useStore } from "../../lib/store"
import { useTreeActions, createNewFile } from "./useTreeActions"
import { basename } from "../../lib/paths"
import { collapseSelectionToAnchor } from "./selection"
import { targetParentDir } from "./targetDir"

/**
 * Global keyboard shortcuts for the file tree:
 *   - F2: rename the selected file
 *   - Delete / Backspace: move the selected file to trash (with confirm)
 *   - Cmd/Ctrl+N: create a new note (in the selected folder, or at root)
 *
 * The non-Cmd shortcuts only fire when no input/textarea/contenteditable is
 * focused, so they don't fight with editor keystrokes. Cmd+N always fires —
 * users expect it to work even while typing.
 */
export function useTreeShortcuts() {
  const actions = useTreeActions()

  useEffect(() => {
    function isEditableTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false
      const tag = t.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
      if (t.isContentEditable) return true
      // BlockNote / CodeMirror render inside contenteditable, but a parent
      // walk handles cases where focus is on a wrapping element.
      let el: HTMLElement | null = t
      while (el) {
        if (el.isContentEditable) return true
        el = el.parentElement
      }
      return false
    }

    function onKey(e: KeyboardEvent) {
      // Cmd/Ctrl+N runs before the editable-target gate so it works while
      // the editor is focused. Target dir follows the tree-selection rules
      // in `targetParentDir`: selected folder → that folder, selected file
      // → its parent, otherwise the vault root.
      const meta = e.metaKey || e.ctrlKey
      if (meta && !e.shiftKey && !e.altKey && (e.key === "n" || e.key === "N")) {
        const s = useStore.getState()
        const target = targetParentDir(s.tree, s.selectedPath, s.rootPath)
        if (target) {
          e.preventDefault()
          createNewFile(target).catch(console.error)
        }
        return
      }

      if (isEditableTarget(e.target)) return

      // Esc collapses multi-selection back to a single-row selection.
      // Handle before the early-return on no-selection so it always works.
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (collapseSelectionToAnchor()) {
          e.preventDefault()
          return
        }
      }

      const sel = useStore.getState().selectedPath
      if (!sel) return
      // Avoid clobbering Cmd-/Ctrl- combos for the remaining shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === "F2") {
        e.preventDefault()
        useStore.getState().setRenamingPath(sel)
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        const selectedPaths = useStore.getState().selectedPaths
        if (selectedPaths.size > 1) {
          const paths = Array.from(selectedPaths)
          if (confirm(`Move ${paths.length} items to trash?`)) {
            actions.trashMany(paths).catch(console.error)
          }
        } else if (confirm(`Move "${basename(sel)}" to trash?`)) {
          actions.trash(sel).catch(console.error)
        }
      }
    }

    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [actions])
}
