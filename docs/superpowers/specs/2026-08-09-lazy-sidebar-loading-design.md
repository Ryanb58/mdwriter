# Lazy Sidebar Loading Design

**Date:** 2026-08-09
**Status:** Pending written-spec review

## Problem

Opening a vault currently calls `list_tree`, which recursively walks every visible directory before mdwriter can commit the vault to the frontend. The complete `TreeNode` is also rebuilt after broad filesystem changes. This makes startup and sidebar refresh cost grow with the entire vault even when the user only needs the root and a few expanded folders.

The full tree currently doubles as a note catalog for the file palette, wikilinks, AI note mentions, pinned-file validation, and recent-file restoration. Making only the sidebar lazy therefore requires explicit on-demand replacements for those lookups. This PR must not add a background, persistent, metadata, or content index, and it must not change full-content search.

## Goals

- Show the vault root after reading only its immediate children.
- Read a directory only when the user expands it or when mdwriter must reveal a known path.
- Retain loaded directory contents across collapse and re-expansion.
- Refresh only loaded directories affected by filesystem changes.
- Restore and reveal a recent nested file without recursively walking unrelated folders.
- Preserve complete file-palette, note-mention, pinned-file, search-result, and link-navigation behavior through explicit on-demand filesystem calls.
- Preserve existing path-scope validation, `.gitignore` settings, save guards, watcher echo suppression, and stale-response protection.

## Non-goals

- A background or persistent workspace index.
- An in-memory catalog that survives after the requesting palette or popover closes.
- Changes to `search_vault`, content-search ranking, debounce behavior, or result presentation.
- Tree virtualization, pagination, filesystem polling, or loading file contents for sidebar rows.
- Prefetching arbitrary sibling or descendant folders.
- Changing the visual hierarchy or file-management feature set.

## User Experience

The root-level files and folders appear as soon as the root directory read completes. A collapsed folder behaves exactly as it does now. Expanding an unloaded folder immediately opens the row, shows a small inline loading indicator beneath it, and requests only that folder's direct children. The response fills the existing row without collapsing it or moving selection.

Collapsing a loaded folder keeps its children in session memory, so re-expansion is immediate. A failed directory read keeps the folder expanded and shows a compact **Retry** row. Other loaded branches remain usable.

Opening a nested note from recent files, pinned files, the file palette, content search, an AI note mention, or an internal link opens the note through the existing selection and save-safe navigation flow. Its ancestor folders are loaded and expanded in the background so the active file becomes visible in the sidebar. The document read is not delayed on sidebar hydration.

The file palette and note-mention popovers show a loading state while they perform a live Markdown-file enumeration. Results live only for the lifetime of that open surface. Internal-link activation performs a live target resolution. These operations do not populate an application-wide catalog.

Wikilinks whose targets are already present in loaded folders retain resolved styling. Every other target is rendered with a neutral wikilink style until activation; absence from a partial tree is never treated as proof that a link is broken. Activating it resolves against the complete vault. A successful lookup opens the target, while a failed complete lookup marks the activated link broken and otherwise keeps the existing no-navigation behavior.

## Data Model

The shared `TreeNode` directory variant becomes:

```ts
type DirectoryNode = {
  kind: "dir"
  name: string
  path: string
  children: TreeNode[]
  loaded: boolean
}
```

The Rust wire shape mirrors this field. The root returned by `list_tree` has `loaded: true`; every child directory initially has `loaded: false` and an empty `children` array. A directory returned by `list_directory` is loaded, while its direct directory children are unloaded.

Transient request state remains frontend-only and session-only:

- `loadingFolders: Set<string>` tracks visible folder requests;
- `folderLoadErrors: Record<string, string>` supports local retry;
- module-local request generations prevent a late response from replacing newer data.

Neither field is persisted. Changing vaults clears both.

## Backend Commands

### Shallow tree commands

`list_tree(root, options)` remains the authority that canonicalizes and establishes the active vault scope, but it changes from a recursive walk to a shallow read of the root.

A new `list_directory(path, options)` command:

- validates `path` through the active-vault guard;
- requires the target to be a directory;
- lists only immediate, visible children;
- applies the same extension, hidden-file, and `.gitignore` options as the root read;
- returns a loaded directory node with unloaded child directories.

Because detecting whether a directory contains a displayable descendant would itself require recursion, shallow reads include every non-hidden, non-ignored child directory. A folder containing only unsupported files may therefore appear empty when expanded. Empty folders are already valid sidebar entries, so this is consistent and avoids hidden eager work.

### On-demand note lookup

One uncached command preserves behavior that previously depended on the complete tree:

- `list_markdown_notes(root, options)` performs a recursive walk and returns flat path/name/relative-path/mtime metadata for the currently open file palette or note-mention surface. It honors `.gitignore` when the existing `hideGitignored` option is enabled.

The command also supplies link activation: the frontend enumerates the notes and applies the existing pure TypeScript target resolver, keeping one canonical implementation of exact-path, suffix, and filename matching. The command validates the requested root against the active vault. It returns data to the caller only and never writes it into `AppState`. Concurrent callers may complete independently; the frontend discards results if the vault or requesting surface changed.

Full-content search continues calling the existing `search_vault` command without modification.

## Frontend Tree Operations

A focused `lazyTree.ts` module owns pure immutable operations:

- `replaceDirectory(tree, listing)` replaces one directory's direct listing;
- loaded descendant nodes with the same paths are grafted onto a refreshed listing so expanded work is not discarded;
- `loadedDirectoryPaths(tree)` identifies branches eligible for targeted refresh;
- `ancestorDirectories(root, target)` returns the in-vault parent chain used by reveal;
- `findNode` continues returning only nodes currently loaded into the sidebar.

`loadDirectory(path)` coordinates IPC and store state. It deduplicates an in-flight request for the same path, clears only that path's prior error, and commits only when the active root and request generation still match. Expanding an unloaded directory calls it automatically. Expanding a loaded directory performs no I/O.

`revealPath(path)` requests missing ancestor directories from root to parent, merges each valid result, expands the ancestor set, and leaves document selection independent. Callers can select the file immediately and invoke `revealPath` without awaiting it.

`refreshDirectory(path)` rereads one loaded directory and uses the same guarded merge. File creation, folder creation, rename, move, import, and trash refresh only the affected parent directories. The settings action reloads the root and every previously loaded directory under the new tree options, discarding branches filtered out by the new settings.

## Startup and Vault Switching

Folder opening retains the current save barrier, watcher swap, canonical-root commit, and rollback behavior. Its initial `list_tree` call becomes shallow. After committing the new root:

1. mdwriter reads the saved recent path for that canonical or legacy root;
2. it loads the path's ancestor directories in order;
3. if the final parent listing contains that Markdown file, it expands the ancestors and selects the file;
4. if the path is missing, startup remains on the empty editor without showing a stale-file error.

All directory responses are guarded by the canonical root. Work begun for an outgoing vault cannot mutate the incoming vault.

## Watcher Behavior

The watcher continues emitting the existing batched `vault-changed` paths and continues using the current recent-self-write window.

For external membership changes, the frontend computes affected parent directories from the event paths. It refreshes a directory only when that directory is currently loaded. The root is always loaded. Changes beneath an unloaded folder require no immediate read; that folder will observe current disk state when first expanded.

Open-document reload behavior is unchanged. If a batch contains only suppressed self-write paths, no sidebar refresh occurs. A broad or ambiguous event refreshes the root and currently expanded/loaded branches rather than invoking a recursive tree walk.

## File Palette, Mentions, and Links

`useVaultNotes` no longer treats the sidebar tree as a complete vault catalog. The existing synchronous `flattenNotes` helper remains useful for loaded-tree presentation and neutral wikilink decoration, but complete-note consumers use a new request-scoped hook:

- File mode begins `list_markdown_notes` when the palette opens.
- AI note-mention completion begins it when the `[[` trigger becomes active.
- Results are cancelled logically on close, query-surface change, or vault switch and are released on unmount.
- Link activation calls `list_markdown_notes`, applies the existing resolver, and verifies the root is still active before selecting the result.

Raw and block editor wikilink renderers distinguish `resolved`, `broken`, and `unknown`. Only a target rejected by a complete on-demand lookup may be marked broken; absence from a partial lazy tree means unknown.

## Failure and Race Handling

- A rejected folder read affects only that folder and exposes Retry.
- Stale folder, palette, mention, and link responses are ignored after a root change.
- Duplicate expansion clicks share one in-flight request.
- A folder removed while its request is in flight is not reinserted if its parent refresh no longer contains it.
- A path outside the active vault is rejected by Rust before disk access.
- Failed background reveal never blocks or closes an otherwise successfully opened document.
- Live note enumeration errors show the existing empty/error affordance in the requesting surface and do not affect the sidebar.
- No read path writes document bytes or participates in the autosave/self-write loop.

## Testing

### Rust unit tests

- Root listing reads only immediate children and marks child directories unloaded.
- Directory listing is shallow, sorted, filtered by options, and active-vault scoped.
- Nested reads honor `.gitignore` when requested without recursively enumerating descendants.
- Note enumeration returns every eligible Markdown path and no unsupported files.
- The returned note metadata preserves the fields needed by the existing exact relative-path, suffix, basename, extension, case-insensitive, and deterministic duplicate resolver tests.

### Frontend unit and component tests

- Directory replacement preserves loaded descendants with matching paths.
- First expansion loads once; collapse/re-expansion performs no second request.
- Loading and Retry states are local to one folder.
- Stale and out-of-order directory responses cannot overwrite the current vault or newer listing.
- Revealing a nested path loads only its ancestor chain and expands it.
- Recent-file restoration selects only a file confirmed by its parent listing.
- File operations refresh affected parents without requesting a full tree.
- Watcher batches refresh loaded affected directories and ignore unloaded branches.
- File palette and mention completion receive complete on-demand results independent of loaded sidebar state.
- Link activation resolves and opens a target outside loaded branches.
- Unknown wikilinks are not displayed as broken.

### Regression verification

- Existing content-search tests and `search_vault` Rust tests pass unchanged.
- Save-before-navigation and folder-switch rollback tests continue to pass.
- Tree multiselect, keyboard navigation, drag-and-drop, rename, import, create, and trash continue to work in loaded branches.
- Pinned and recent nested notes open and reveal correctly.
- Full frontend tests, TypeScript build, Playwright smoke tests, and Rust unit tests pass before handoff.

## Acceptance Criteria

- Opening a vault reads only the root directory before the sidebar becomes usable.
- Expanding a directory reads only that directory and never recursively loads its descendants.
- Re-expanding a loaded folder is immediate.
- A nested recent file is restored by loading only its ancestor chain.
- External changes refresh only relevant loaded directories.
- File palette, note mentions, pinned files, search results, and internal links work for files in unloaded folders.
- Existing full-content search behavior and performance are unchanged.
- No background, persistent, metadata, or content index is added.
