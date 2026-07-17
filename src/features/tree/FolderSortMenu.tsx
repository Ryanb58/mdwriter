import { Check } from "@phosphor-icons/react"
import { TreeContextMenu, type ContextActionGroup } from "./TreeContextMenu"
import { useStore } from "../../lib/store"
import { DEFAULT_FOLDER_SORT, sameSort, type FolderSortPref } from "./sortChildren"

const SORT_OPTIONS: { label: string; pref: FolderSortPref }[] = [
  { label: "Name (A → Z)", pref: { key: "name", dir: "asc" } },
  { label: "Name (Z → A)", pref: { key: "name", dir: "desc" } },
  { label: "Date added (newest first)", pref: { key: "added", dir: "desc" } },
  { label: "Date added (oldest first)", pref: { key: "added", dir: "asc" } },
]

/**
 * Anchored picker for one folder's file ordering. Backed by
 * `folderSortPrefs` — choosing the app default clears the entry rather
 * than storing it (setFolderSortPref owns that rule).
 */
export function FolderSortMenu({
  x, y, folderPath, onClose,
}: {
  x: number
  y: number
  folderPath: string
  onClose: () => void
}) {
  const prefs = useStore((s) => s.folderSortPrefs)
  const setFolderSortPref = useStore((s) => s.setFolderSortPref)
  const active = prefs[folderPath] ?? DEFAULT_FOLDER_SORT
  const groups: ContextActionGroup[] = [
    SORT_OPTIONS.map(({ label, pref }) => ({
      label,
      icon: sameSort(active, pref) ? <Check size={14} /> : undefined,
      onClick: () => setFolderSortPref(folderPath, pref),
    })),
  ]
  return <TreeContextMenu x={x} y={y} groups={groups} onClose={onClose} />
}
