# Per-folder sort control (issue #65) — design

Date: 2026-07-17
Issue: https://github.com/Ryanb58/mdwriter/issues/65

## Problem

Files inside a folder always render dirs-first, then files A→Z (fixed in Rust
`list_tree`). Users can't order a folder's files by when they were added, and
can't vary ordering per folder. Issue #65 asks for a per-folder sort control
(date added / alphabetical, ascending/descending), persisted per folder across
sessions, defaulting to newest first.

## Decision summary

- Sorting happens in the **frontend**; the backend keeps returning the tree in
  its current canonical order and additionally reports file creation time.
- Default sort (no stored preference) is **date added, newest first** — as
  specified in the issue and confirmed by the issue author.
- Only **files** are re-ordered. Folders always sort first, A→Z, unaffected by
  the control.

## Backend (Rust)

`src-tauri/src/commands/fs.rs`:

- `TreeNode::File` gains `created: Option<i64>` (Unix seconds), serialized as
  `created`, skipped when `None` — same contract as the existing `mtime`.
- Populated via `std::fs::metadata(path).created()`. Filesystems that can't
  report birth time yield `None`; the frontend falls back to `mtime`.
- New unit test asserting `created` is populated for a freshly written file.

## Frontend

### Sort model — `src/features/tree/sortChildren.ts` (new, pure)

```ts
export type FolderSortKey = "name" | "added"
export type FolderSortDir = "asc" | "desc"
export type FolderSortPref = { key: FolderSortKey; dir: FolderSortDir }
export const DEFAULT_FOLDER_SORT: FolderSortPref = { key: "added", dir: "desc" }

export function sortChildren(children: TreeNode[], pref?: FolderSortPref): TreeNode[]
```

- Dirs first (A→Z, case-insensitive), then files ordered by `pref ?? DEFAULT_FOLDER_SORT`.
- `added` compares `created ?? mtime ?? 0`; ties (and the `name` key) compare
  names case-insensitively; final tie-break is the raw name so the result is
  deterministic.
- Pure and stateless — unit-testable without React.

### Store — `src/lib/store.ts`

- `folderSortPrefs: Record<string, FolderSortPref>` keyed by the folder's
  absolute path (the vault root path keys root-level files).
- `setFolderSortPref(path: string, pref: FolderSortPref | null)` — `null` (or
  a pref equal to the default) deletes the entry so the map only holds
  explicit deviations.
- Persisted: added to `partialize` and validated in `merge` (unknown shapes
  dropped), following the documented pattern for new persisted state.
- Stale keys (folder renamed/deleted) are harmless — never read again; same
  tolerance as `blockModeOverrides`.

### Applying the sort — all three consumers of child order

1. `TreePane` — root-level children via `sortChildren(tree.children, prefs[rootPath])`.
2. `TreeNodeView` — each expanded dir's children via `sortChildren(children, prefs[dir.path])`.
3. `visibleRows(tree, expanded, prefs)` — gains a `prefs` parameter and sorts
   during its walk, so shift-click range selection and keyboard navigation
   (`selection.ts`, `useTreeShortcuts.ts`) always match the rendered order.

### UI — `src/features/tree/FolderSortMenu.tsx` (new) + row control

- Each folder row gets a right-aligned `ArrowsDownUp` (phosphor) icon button,
  using the exact affordance of the existing pin button: `opacity-0
  group-hover:opacity-100`, except it stays visible (`opacity-100`) when the
  folder has a non-default sort.
- Clicking opens a small anchored menu with four options — Name (A→Z),
  Name (Z→A), Date added (newest first), Date added (oldest first) — with a
  check mark on the active option. Picking the current option closes the menu
  without change; picking the default clears the stored entry.
- The tree pane header row hosts the same button (next to New file / New
  folder) controlling root-level files, keyed by `rootPath`.
- Clicks on the button/menu `stopPropagation` so they never toggle folder
  expansion or selection.

## Error handling

- Missing timestamps (`created` and `mtime` both absent) sort as oldest.
- Corrupt persisted prefs are discarded by `merge` validation and fall back to
  the default.

## Testing

- `sortChildren.test.ts` — dirs-first invariant, all four key/dir combos,
  `created`→`mtime`→0 fallback chain, name tie-breaks, input not mutated.
- `visibleRows.test.ts` — rows honor per-folder prefs at multiple depths.
- Store test — `setFolderSortPref` set/clear semantics and `merge` validation
  of good/bad persisted shapes.
- `FolderSortMenu` component test — menu opens, shows active check, selecting
  an option writes the pref, default selection clears it.
- Rust — `created` populated for a new file.
- Gate: `pnpm test` and `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  both green.

## Out of scope

- Sorting folders themselves; recursive "apply to subfolders"; sort by
  modified time or size; drag-reorder/manual ordering.
