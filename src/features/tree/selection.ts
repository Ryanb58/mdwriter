import { useStore } from "../../lib/store"
import { visibleRows, rangeBetween } from "./visibleRows"

/**
 * Click semantics for the tree:
 *   - Plain click   → replace selection with the clicked row.
 *   - Cmd/Ctrl-click → toggle the clicked row in/out of the selection.
 *   - Shift-click   → extend the selection from the anchor (selectedPath)
 *                     to the clicked row, by visible-row order.
 *
 * After a Cmd-click that removes the current anchor, the next remaining
 * member becomes the new anchor (picked in visible-row order). If the
 * selection becomes empty, anchor goes to null.
 */
export function handleRowClick(
  path: string,
  modifiers: { meta: boolean; shift: boolean },
): void {
  const s = useStore.getState()

  if (modifiers.shift && s.selectedPath) {
    const rows = visibleRows(s.tree, s.expandedFolders)
    const range = rangeBetween(rows, s.selectedPath, path)
    if (range.length > 0) {
      const next = new Set(range.map((r) => r.path))
      s.setSelectedPaths(next, s.selectedPath)
      return
    }
    // Anchor not in visible rows (e.g. ancestor collapsed) — fall through
    // to a plain replace so the click still does something.
  }

  if (modifiers.meta) {
    const next = new Set(s.selectedPaths)
    if (next.has(path)) {
      next.delete(path)
      let anchor: string | null = s.selectedPath
      if (anchor === path) {
        if (next.size === 0) anchor = null
        else {
          const rows = visibleRows(s.tree, s.expandedFolders)
          anchor = rows.find((r) => next.has(r.path))?.path ?? null
        }
      }
      s.setSelectedPaths(next, anchor)
    } else {
      next.add(path)
      s.setSelectedPaths(next, path)
    }
    return
  }

  // Plain click — replace selection.
  s.setSelected(path)
}

/**
 * Esc behavior: if there's a multi-selection, collapse it back to just
 * the anchor row. If there's only one (or zero), no-op.
 */
export function collapseSelectionToAnchor(): boolean {
  const s = useStore.getState()
  if (s.selectedPaths.size <= 1) return false
  s.setSelected(s.selectedPath)
  return true
}
