# Lazy Sidebar Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidebar load one directory level at a time while preserving startup restoration, file operations, watcher updates, complete note lookup, and existing content search.

**Architecture:** Rust exposes shallow root/directory reads plus an uncached Markdown-note enumeration. The frontend stores explicit directory load state, merges shallow listings immutably, and coordinates guarded expansion/reveal/refresh requests. Features that previously treated the tree as a complete vault catalog request a live note list only while their palette, completion, or link activation needs it.

**Tech Stack:** Rust, Tauri 2 commands/state guards, `ignore`, React 19, TypeScript, Zustand, Vitest, Testing Library, pnpm, Cargo.

## Global Constraints

- Do not change `search_vault`, content-search ranking, debounce behavior, or result presentation.
- Do not add a background, persistent, metadata, or content index.
- Do not cache complete note enumerations beyond the lifetime of their requesting UI surface.
- Keep all frontend IPC calls inside `src/lib/ipc.ts`.
- Preserve the save coordinator and call `noteSelfWrite` before every frontend-originated write.
- Preserve active-vault path validation for every new Rust command.
- Do not introduce new dependencies.
- Do not mention the audited application in branch names, commit messages, variables, types, comments, or documentation.

---

### Task 1: Shallow Rust Directory Contract

**Files:**
- Modify: `src-tauri/src/commands/fs.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/ipc.ts`
- Test: `src-tauri/src/commands/fs.rs` (`#[cfg(test)]` module)

**Interfaces:**
- Produces: directory wire shape `{ kind: "dir", name, path, children, loaded }`.
- Produces: `list_tree(root, options) -> TreeNode`, shallow and scope-establishing.
- Produces: `list_directory(path, options) -> TreeNode`, shallow and active-vault scoped.
- Consumes: existing `TreeOptions`, `resolve_in_root`, visibility filters, sort order, and `AppState.active_vault`.

- [ ] **Step 1: Add failing Rust tests for shallow listings**

Add tests that create `/root/top.md`, `/root/nested/inside.md`, and `/root/nested/deeper/leaf.md`, then assert:

```rust
let root = list_tree(dir.path().to_path_buf(), None).unwrap();
let TreeNode::Dir { children, loaded, .. } = root else { panic!() };
assert!(loaded);
let nested = children.iter().find(|node| node.path() == dir.path().join("nested")).unwrap();
let TreeNode::Dir { children, loaded, .. } = nested else { panic!() };
assert!(!loaded);
assert!(children.is_empty());

let nested = list_directory_for_test(dir.path(), &dir.path().join("nested"), None).unwrap();
let TreeNode::Dir { children, loaded, .. } = nested else { panic!() };
assert!(loaded);
assert!(children.iter().any(|node| node.path().ends_with("inside.md")));
let deeper = children.iter().find(|node| node.path().ends_with("deeper")).unwrap();
assert!(matches!(deeper, TreeNode::Dir { loaded: false, children, .. } if children.is_empty()));
```

Add one test proving a nested `.gitignore`-matched directory is absent when `hide_gitignored` is true, and one proving a directory with only unsupported files is still returned as an unloaded directory.

- [ ] **Step 2: Run the focused Rust tests and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib fs::tests`

Expected: compilation fails because directory nodes have no `loaded` field and `list_directory_for_test` does not exist.

- [ ] **Step 3: Implement a single-level directory builder**

Change the Rust enum and builder around this contract:

```rust
pub enum TreeNode {
    Dir {
        name: String,
        path: PathBuf,
        children: Vec<TreeNode>,
        loaded: bool,
    },
    File { name: String, path: PathBuf, mtime: Option<i64> },
}

fn build_shallow_directory(
    path: &Path,
    root: &Path,
    opts: &TreeOptions,
    gi: Option<&Gitignore>,
) -> Result<TreeNode> {
    // Read only `path`; child directories are emitted with loaded=false and
    // empty children. Visible files carry their existing mtime metadata.
}
```

Keep sorting directories before files. Do not call the old recursive `build_tree` from `list_tree_inner`. Remove recursive visibility pruning and retain every non-hidden, non-ignored child directory.

Add an active-root helper that clones the canonical vault root under the mutex, resolve the requested directory through `resolve_in_root`, and build the root `.gitignore` matcher with that canonical root.

- [ ] **Step 4: Register and expose `list_directory`**

Register `commands::fs::list_directory` in `tauri::generate_handler!` and add:

```ts
export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[]; loaded: boolean }
  | { kind: "file"; name: string; path: string; mtime?: number }

listDirectory: (path: string, options?: TreeOptions) =>
  invoke<TreeNode>("list_directory", { path, options: options ?? null }),
```

Update Rust pattern matches and Rust test fixtures to include or ignore `loaded` explicitly.

- [ ] **Step 5: Run focused tests and TypeScript compilation**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib fs::tests`

Expected: PASS.

Run: `pnpm build`

Expected: FAIL only at TypeScript directory fixtures and constructors that have not yet adopted `loaded`; record those locations for Task 2.

- [ ] **Step 6: Commit the shallow backend contract**

```bash
git add src-tauri/src/commands/fs.rs src-tauri/src/lib.rs src/lib/ipc.ts
git commit -m "feat: add shallow directory loading commands"
```

---

### Task 2: Immutable Lazy-Tree Model and Store State

**Files:**
- Create: `src/features/tree/lazyTree.ts`
- Create: `src/features/tree/__tests__/lazyTree.test.ts`
- Modify: `src/lib/store.ts`
- Modify: TypeScript test fixtures reported by Task 1

**Interfaces:**
- Consumes: required `TreeNode.loaded` from Task 1.
- Produces: `replaceDirectory(tree, listing)`, `loadedDirectoryPaths(tree)`, and `ancestorDirectories(root, target)`.
- Produces store state: `loadingFolders`, `folderLoadErrors`, `setFolderLoading`, `setFolderLoadError`, and `clearFolderLoadState`.

- [ ] **Step 1: Write failing pure tree-operation tests**

Cover these concrete cases:

```ts
expect(replaceDirectory(root, refreshedNotes)).toEqual(expectedRoot)
expect(findNode(replaceDirectory(root, refreshedNotes), "/vault/notes/deep")?.kind).toBe("dir")
expect(loadedDirectoryPaths(root)).toEqual(["/vault", "/vault/notes"])
expect(ancestorDirectories("/vault", "/vault/notes/deep/a.md")).toEqual([
  "/vault",
  "/vault/notes",
  "/vault/notes/deep",
])
expect(ancestorDirectories("/vault", "/outside/a.md")).toEqual([])
```

The refresh fixture must include a previously loaded nested branch and prove that the branch is grafted onto the same-path shallow child returned by the backend. Also prove that a removed child is not resurrected.

- [ ] **Step 2: Run the pure tests and verify failure**

Run: `pnpm test -- src/features/tree/__tests__/lazyTree.test.ts`

Expected: FAIL because `lazyTree.ts` does not exist.

- [ ] **Step 3: Implement pure tree helpers**

Use immutable recursion and exact path equality:

```ts
export function replaceDirectory(tree: TreeNode | null, listing: TreeNode): TreeNode | null
export function loadedDirectoryPaths(tree: TreeNode | null): string[]
export function ancestorDirectories(root: string, target: string): string[]
```

`replaceDirectory` must reject a file listing, preserve the existing tree when the target path is absent, and for every refreshed direct child graft the old child only when both nodes are directories and the old child has `loaded: true`. Never graft a child absent from the refreshed listing.

- [ ] **Step 4: Add transient folder request state to Zustand**

Add these non-persisted fields and actions:

```ts
loadingFolders: Set<string>
folderLoadErrors: Record<string, string>
setFolderLoading(path: string, loading: boolean): void
setFolderLoadError(path: string, message: string | null): void
clearFolderLoadState(): void
```

Initialize them in the store and clear them in the atomic vault commit inside `useFolderPicker.ts`. Do not add them to `partialize` or `merge`.

- [ ] **Step 5: Update TypeScript fixtures to state directory load intent**

Add `loaded: true` to fixtures representing complete existing trees and `loaded: false` only to fixtures specifically exercising an unloaded directory. Update helper constructors in `visibleRows.test.ts`, `selection.test.ts`, `targetDir.test.ts`, `vaultNotes.test.ts`, and editor/folder tests.

- [ ] **Step 6: Run pure tests and build**

Run: `pnpm test -- src/features/tree/__tests__/lazyTree.test.ts src/features/tree/__tests__/visibleRows.test.ts src/features/tree/__tests__/selection.test.ts src/lib/__tests__/vaultNotes.test.ts`

Expected: PASS.

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 7: Commit the frontend model**

```bash
git add src/features/tree/lazyTree.ts src/features/tree/__tests__/lazyTree.test.ts src/lib/store.ts src
git commit -m "feat: model lazy sidebar directories"
```

---

### Task 3: Directory Load, Reveal, and Sidebar UI

**Files:**
- Create: `src/features/tree/treeLoader.ts`
- Create: `src/features/tree/__tests__/treeLoader.test.ts`
- Modify: `src/features/tree/TreeNode.tsx`
- Modify: `src/features/folder/useFolderPicker.ts`
- Modify: `src/features/folder/__tests__/useFolderPicker.test.ts`

**Interfaces:**
- Consumes: `ipc.listDirectory`, Task 2 tree helpers/store state, `treeOptionsFromSettings`.
- Produces: `loadDirectory(path)`, `revealPath(path)`, `refreshDirectories(paths)`, and `reloadLoadedDirectories()`.
- Produces: folder expansion UI with local loading and retry rows.

- [ ] **Step 1: Write failing coordinator tests**

Mock `ipc.listDirectory` and cover:

```ts
await Promise.all([loadDirectory("/vault/notes"), loadDirectory("/vault/notes")])
expect(ipc.listDirectory).toHaveBeenCalledTimes(1)

const result = await revealPath("/vault/a/b/note.md")
expect(result).toBe("found")
expect(ipc.listDirectory.mock.calls.map(([path]) => path)).toEqual([
  ["/vault/a"],
  ["/vault/a/b"],
].flat())
expect(useStore.getState().expandedFolders).toEqual(
  new Set(["/vault/a", "/vault/a/b"]),
)
```

Also test a missing final file returns `"missing"`, a root switch discards an old response, a newer request wins over an older response, and a failed request sets only that folder's error.

- [ ] **Step 2: Run the coordinator tests and verify failure**

Run: `pnpm test -- src/features/tree/__tests__/treeLoader.test.ts`

Expected: FAIL because `treeLoader.ts` does not exist.

- [ ] **Step 3: Implement guarded request coordination**

Expose exact signatures:

```ts
export async function loadDirectory(path: string): Promise<"loaded" | "missing" | "stale">
export async function revealPath(path: string): Promise<"found" | "missing" | "stale">
export async function refreshDirectories(paths: readonly string[]): Promise<void>
export async function reloadLoadedDirectories(): Promise<void>
```

Maintain module-local `Map<string, Promise<"loaded" | "missing" | "stale">>` deduplication and a monotonically increasing request generation per folder. Before each state commit, compare the captured root to `useStore.getState().rootPath`, verify the target directory still exists in the current tree, and apply `replaceDirectory`. `revealPath` skips ancestors already loaded, loads the rest root-to-leaf, expands only confirmed directories, and confirms the final file in its parent listing.

- [ ] **Step 4: Connect folder expansion and local feedback**

In `TreeNode.tsx`, replace the plain directory toggle with:

```ts
if (isDir && !modifiedClick) {
  const opening = !expanded
  toggleFolderExpanded(node.path, opening)
  if (opening && !node.loaded) void loadDirectory(node.path)
}
```

When expanded and loading, render an indented `Loading…` row. When `folderLoadErrors[node.path]` exists, render a button labelled `Retry` that calls `loadDirectory(node.path)`. Loaded children keep the existing recursive rendering.

- [ ] **Step 5: Restore a recent nested file through targeted hydration**

Make `restoreLastFile` asynchronous. After the shallow root commits, call `await revealPath(saved)` and select only on `"found"`. Preserve canonical/legacy recent-key fallback and do not surface an error for `"missing"` or `"stale"`.

Update folder-picker tests so the new root fixture is shallow, mock ancestor `listDirectory` responses, and assert only `/new/notes` is loaded to restore `/new/notes/last.md`.

- [ ] **Step 6: Run coordinator, component, and folder tests**

Run: `pnpm test -- src/features/tree/__tests__/treeLoader.test.ts src/features/folder/__tests__/useFolderPicker.test.ts src/features/tree/__tests__/selection.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit lazy expansion and reveal**

```bash
git add src/features/tree/treeLoader.ts src/features/tree/__tests__/treeLoader.test.ts src/features/tree/TreeNode.tsx src/features/folder/useFolderPicker.ts src/features/folder/__tests__/useFolderPicker.test.ts
git commit -m "feat: load sidebar folders on demand"
```

---

### Task 4: Request-Scoped Complete Note Enumeration

**Files:**
- Create: `src-tauri/src/commands/notes.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/vaultNotes.ts`
- Create: `src/lib/__tests__/onDemandVaultNotes.test.tsx`
- Test: `src-tauri/src/commands/notes.rs` (`#[cfg(test)]` module)

**Interfaces:**
- Produces Rust/TypeScript `VaultNoteRecord { name, path, rel, mtime? }`.
- Produces `ipc.listMarkdownNotes(root, options)`.
- Produces `fetchVaultNotes(root)` and `useOnDemandVaultNotes(enabled)` returning `{ notes, status, error }`.
- Consumes active-vault scope and `TreeOptions.hideGitignored`; does not mutate backend or frontend global state.

- [ ] **Step 1: Write failing Rust note-enumeration tests**

Create fixtures with `.md`, `.markdown`, uppercase extensions, unsupported files, hidden directories, and a root `.gitignore`. Assert deterministic relative-path order and metadata:

```rust
let notes = list_markdown_notes_impl(root.clone(), TreeOptions::default()).unwrap();
assert_eq!(notes.iter().map(|n| n.rel.as_str()).collect::<Vec<_>>(), vec![
    "a.md",
    "nested/b.markdown",
]);
assert!(notes.iter().all(|n| n.path.is_absolute()));
```

Add a command-level scope test using the testable active-root helper or extracted guard input so a different root is rejected.

- [ ] **Step 2: Run Rust tests and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib notes::tests`

Expected: FAIL because the notes module does not exist.

- [ ] **Step 3: Implement uncached note enumeration**

Use `ignore::WalkBuilder` for each request. Honor hidden paths and `hide_gitignored`; accept `.md` and `.markdown` case-insensitively; collect mtime through the existing helper or a `pub(crate)` extraction; sort by relative path before returning. Do not add any field to `AppState`.

Register:

```rust
#[tauri::command]
pub fn list_markdown_notes(
    state: State<'_, AppState>,
    root: PathBuf,
    options: Option<TreeOptions>,
) -> Result<Vec<VaultNoteRecord>>
```

- [ ] **Step 4: Add the IPC mapping and request-scoped hook tests**

Map snake-case wire fields inside `ipc.ts`. Test that `useOnDemandVaultNotes(true)` loads once per mounted hook, switches to `ready`, ignores a response after the root changes, and releases results on unmount. Test `enabled=false` makes no IPC call.

- [ ] **Step 5: Implement the request-scoped frontend API**

Keep `flattenNotes` and rename the existing tree hook to `useLoadedVaultNotes`. Add:

```ts
export async function fetchVaultNotes(root: string): Promise<VaultNote[]>
export function useOnDemandVaultNotes(enabled: boolean): {
  notes: VaultNote[]
  status: "idle" | "loading" | "ready" | "error"
  error: string | null
}
```

Read current tree options at request time. Store results only in hook-local React state. Guard commits against the captured root and effect cancellation.

- [ ] **Step 6: Run Rust and hook tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib notes::tests`

Expected: PASS.

Run: `pnpm test -- src/lib/__tests__/onDemandVaultNotes.test.tsx src/lib/__tests__/vaultNotes.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit request-scoped note enumeration**

```bash
git add src-tauri/src/commands/notes.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/lib/ipc.ts src/lib/vaultNotes.ts src/lib/__tests__/onDemandVaultNotes.test.tsx
git commit -m "feat: enumerate vault notes on demand"
```

---

### Task 5: Preserve Palette, Completion, and Link Behavior

**Files:**
- Modify: `src/features/palette/CommandPalette.tsx`
- Create: `src/features/palette/__tests__/CommandPalette.files.test.tsx`
- Modify: `src/features/ai/MessageInput.tsx`
- Modify: `src/features/editor/RawEditor.tsx`
- Modify: `src/features/editor/RawWikilinkPopup.tsx`
- Modify: `src/features/editor/BlockEditor.tsx`
- Modify: `src/features/editor/WikilinkSuggestionMenu.tsx`
- Modify: `src/features/editor/useLinkActivation.ts`
- Modify: `src/features/editor/wikilinkCM.ts`
- Modify: `src/features/editor/wikilinkInline.tsx`
- Modify: `src/features/editor/__tests__/useLinkActivation.test.tsx`
- Modify: `src/features/editor/__tests__/wikilinkCM.test.ts`
- Modify: `src/features/editor/__tests__/RawEditor.test.tsx`
- Modify: `src/features/editor/__tests__/BlockEditor.initialization.test.tsx`
- Modify: `src/features/ai/__tests__/wikilinkPopover.test.ts`
- Create: `src/features/palette/__tests__/CommandPalette.files.test.tsx`

**Interfaces:**
- Consumes: Task 4 `useOnDemandVaultNotes`/`fetchVaultNotes`, existing `resolveLinkTarget`, Task 3 `revealPath`.
- Produces: complete palette/completion results independent of loaded sidebar state.
- Produces: link presentation states `"resolved" | "unknown" | "broken"`.

- [ ] **Step 1: Write failing behavior tests**

Add tests proving:

```ts
// File palette uses the complete request-scoped result, not flattenNotes(tree).
expect(screen.getByText("unloaded note")).toBeInTheDocument()

// An absent target in a partial note list is neutral, not broken.
expect(linkDecorationPresentation("elsewhere", [], "cm-wikilink", undefined, false).className)
  .toContain("wikilink--unknown")

// A complete failed lookup is broken.
expect(linkDecorationPresentation("missing", [], "cm-wikilink", undefined, true).className)
  .toContain("wikilink--broken")
```

Extend `useLinkActivation.test.tsx` so a click awaits `ipc.listMarkdownNotes`, resolves a file absent from the loaded tree, calls `setSelected`, and calls `revealPath`. Add a root-switch test proving the stale lookup does not navigate.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm test -- src/features/editor/__tests__/useLinkActivation.test.tsx src/features/editor/__tests__/wikilinkCM.test.ts src/features/palette/__tests__ src/features/ai/__tests__`

Expected: FAIL because complete note consumers still read the sidebar tree and unknown styling does not exist.

- [ ] **Step 3: Move palette and mention surfaces to request-scoped notes**

- `FileMode` calls `useOnDemandVaultNotes(true)` while mounted and renders `Loading files…`/error states.
- `AskMode`, `MessageInput`, and raw completion enable the hook only while their `[[` trigger exists.
- `BlockEditor` supplies an async `getItems(query)` to `SuggestionMenuController` that calls `fetchVaultNotes` for that invocation and filters the returned notes.
- Results vanish when each surface closes; do not write them into Zustand or a module cache.

- [ ] **Step 4: Make editor decorations partial-tree aware**

Rename editor note inputs to `loadedNotes`. Change presentation helpers to accept `complete: boolean`:

```ts
type LinkResolutionState = "resolved" | "unknown" | "broken"

export function linkResolutionState(
  target: string,
  notes: VaultNote[],
  complete: boolean,
): LinkResolutionState {
  if (resolveLinkTarget(target, notes)) return "resolved"
  return complete ? "broken" : "unknown"
}
```

Add `wikilink--unknown` styling that uses the normal link color. Block and raw renderers pass `complete=false` for loaded-tree notes. Keep existing resolved styling. A complete failed activation updates the clicked element to `wikilink--broken` without mutating document text.

- [ ] **Step 5: Resolve activated links against a live complete list**

Make navigation asynchronous:

```ts
async function navigate(rawTarget: string, clicked: HTMLElement) {
  const root = useStore.getState().rootPath
  if (!root) return
  const notes = await fetchVaultNotes(root)
  if (useStore.getState().rootPath !== root) return
  const resolved = resolveLinkTarget(rawTarget, notes)
  if (!resolved) {
    clicked.classList.remove("wikilink--unknown", "wikilink--resolved")
    clicked.classList.add("wikilink--broken")
    return
  }
  useStore.getState().setSelected(resolved.path)
  void revealPath(resolved.path)
}
```

Catch enumeration errors without preventing editing or surfacing a false broken state.

- [ ] **Step 6: Run all affected frontend tests and build**

Run: `pnpm test -- src/features/editor src/features/palette src/features/ai src/lib/__tests__/wikilinkResolve.test.ts`

Expected: PASS.

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 7: Commit complete on-demand navigation behavior**

```bash
git add src/features/palette src/features/ai src/features/editor
git commit -m "feat: preserve note lookup with lazy folders"
```

---

### Task 6: Targeted Refresh for Watcher and File Operations

**Files:**
- Modify: `src/features/tree/useTreeActions.ts`
- Modify: `src/features/tree/moveExecutor.ts`
- Modify: `src/features/tree/importExecutor.ts`
- Modify: `src/features/editor/renameOpenDoc.ts`
- Modify: `src/features/editor/useAutoRename.ts`
- Modify: `src/features/settings/SettingsPanel.tsx`
- Modify: `src/features/watcher/useExternalChanges.ts`
- Modify: `src/features/watcher/__tests__/useExternalChanges.test.ts`
- Create: `src/features/tree/__tests__/targetedRefresh.test.ts`

**Interfaces:**
- Consumes: Task 3 `refreshDirectories` and `reloadLoadedDirectories`.
- Produces: no remaining frontend refresh path that recursively calls `ipc.listTree` after initial vault open.

- [ ] **Step 1: Write failing targeted-refresh tests**

For watcher changes, set a tree where `/vault/loaded` is loaded and `/vault/cold` is unloaded. Assert:

```ts
await handleVaultChange([
  "/vault/loaded/a.md",
  "/vault/cold/b.md",
  "/vault/root.md",
])

expect(ipc.listDirectory).toHaveBeenCalledWith("/vault/loaded", expect.anything())
expect(ipc.listDirectory).toHaveBeenCalledWith("/vault", expect.anything())
expect(ipc.listDirectory).not.toHaveBeenCalledWith("/vault/cold", expect.anything())
expect(ipc.listTree).not.toHaveBeenCalled()
```

Add operation tests asserting create refreshes its parent, rename refreshes distinct source/destination parents, move/import refresh their affected parents, trash refreshes each surviving parent once, and settings reload root plus previously loaded directories.

- [ ] **Step 2: Run watcher and operation tests and verify failure**

Run: `pnpm test -- src/features/watcher/__tests__/useExternalChanges.test.ts src/features/tree/__tests__ src/features/editor/__tests__/renameOpenDoc.test.ts src/features/editor/__tests__/useAutoRename.behavior.test.tsx`

Expected: FAIL because current refresh paths call `listTree`.

- [ ] **Step 3: Replace broad refresh calls with affected parents**

Keep a compatibility export only if it has real callers:

```ts
export async function refreshTree(): Promise<void> {
  await reloadLoadedDirectories()
}
```

Prefer direct calls:

```ts
await refreshDirectories([parentDir])
await refreshDirectories([parent(from), parent(to)])
```

Deduplicate paths inside `refreshDirectories`. Refresh only nodes currently present with `kind === "dir" && loaded === true`; always allow the root.

- [ ] **Step 4: Make watcher refresh only loaded affected parents**

Filter recent self-writes exactly as today, convert remaining event paths to parent directories with the existing path helper, and call `refreshDirectories`. Keep open-document reload outside that filter and preserve all dirty/fingerprint/save-queue guards.

- [ ] **Step 5: Reload loaded branches after visibility-setting changes**

Replace the Settings call to `refreshTree` with `reloadLoadedDirectories`. Capture loaded paths before replacing the root, load the new shallow root, then request previously loaded paths in ancestor order if they remain visible. Clear errors for paths removed by the new settings.

- [ ] **Step 6: Run affected tests and build**

Run: `pnpm test -- src/features/watcher src/features/tree src/features/folder src/features/editor/__tests__/renameOpenDoc.test.ts src/features/editor/__tests__/useAutoRename.behavior.test.tsx`

Expected: PASS.

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 7: Commit targeted refresh behavior**

```bash
git add src/features/tree src/features/watcher src/features/settings/SettingsPanel.tsx src/features/editor/renameOpenDoc.ts src/features/editor/useAutoRename.ts
git commit -m "perf: refresh only loaded sidebar folders"
```

---

### Task 7: Final Regression Verification and Review

**Files:**
- Modify only files required by failures attributable to this feature.
- Review: `docs/superpowers/specs/2026-08-09-lazy-sidebar-loading-design.md`
- Review: `docs/superpowers/plans/2026-08-09-lazy-sidebar-loading.md`

**Interfaces:**
- Consumes the complete feature from Tasks 1-6.
- Produces a verified branch ready to push and open as a pull request.

- [ ] **Step 1: Prove content search remained unchanged**

Run: `git diff origin/main -- src-tauri/src/commands/search.rs src/features/palette/SearchMode.tsx`

Expected: no output.

Run: `pnpm test -- src/features/palette/__tests__/SearchMode.test.tsx`

Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib search::tests`

Expected: PASS.

- [ ] **Step 2: Run all frontend verification**

Run: `pnpm test`

Expected: PASS.

Run: `pnpm build`

Expected: PASS with no TypeScript errors.

Run: `pnpm test:e2e`

Expected: PASS.

- [ ] **Step 3: Run all Rust verification**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Expected: PASS.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings`

Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`

Expected: PASS.

- [ ] **Step 4: Review scope, stale-state guards, and repository cleanliness**

Run: `git diff --check`

Expected: no output.

Run: `git status --short`

Expected: only intentional feature files plus the user's pre-existing `.claude/` and `provn-all-blue.png` untracked paths.

Inspect the diff and confirm:

- `list_tree` is used only to establish/reload a root, never for watcher or file-operation refreshes;
- every async directory/note response checks the captured root;
- folder loads do not mutate persisted store state;
- complete note lists live only in mounted component/hook state;
- no write path was added or changed without preserving `noteSelfWrite`;
- no source-identifying names or text appear in branch, commits, variables, comments, or docs.

- [ ] **Step 5: Commit verification corrections when Step 1-4 changed feature files**

If a verification command required a feature-related correction, stage only the feature paths that this plan owns and commit:

```bash
git add src-tauri/src/commands/fs.rs src-tauri/src/commands/notes.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/lib/ipc.ts src/lib/store.ts src/lib/vaultNotes.ts src/lib/__tests__/onDemandVaultNotes.test.tsx src/features/tree/lazyTree.ts src/features/tree/treeLoader.ts src/features/tree/TreeNode.tsx src/features/tree/useTreeActions.ts src/features/tree/moveExecutor.ts src/features/tree/importExecutor.ts src/features/tree/__tests__/lazyTree.test.ts src/features/tree/__tests__/treeLoader.test.ts src/features/tree/__tests__/targetedRefresh.test.ts src/features/folder/useFolderPicker.ts src/features/folder/__tests__/useFolderPicker.test.ts src/features/palette/CommandPalette.tsx src/features/palette/__tests__/CommandPalette.files.test.tsx src/features/ai/MessageInput.tsx src/features/ai/__tests__/wikilinkPopover.test.ts src/features/editor/RawEditor.tsx src/features/editor/RawWikilinkPopup.tsx src/features/editor/BlockEditor.tsx src/features/editor/WikilinkSuggestionMenu.tsx src/features/editor/useLinkActivation.ts src/features/editor/wikilinkCM.ts src/features/editor/wikilinkInline.tsx src/features/editor/renameOpenDoc.ts src/features/editor/useAutoRename.ts src/features/editor/__tests__/useLinkActivation.test.tsx src/features/editor/__tests__/wikilinkCM.test.ts src/features/editor/__tests__/RawEditor.test.tsx src/features/editor/__tests__/BlockEditor.initialization.test.tsx src/features/settings/SettingsPanel.tsx src/features/watcher/useExternalChanges.ts src/features/watcher/__tests__/useExternalChanges.test.ts
git commit -m "fix: harden lazy sidebar loading"
```

If no correction was required, do not create an empty commit.

- [ ] **Step 6: Push and open the pull request**

```bash
git push -u origin tbrazelton/lazy-sidebar-loading
gh pr create --base main --head tbrazelton/lazy-sidebar-loading --title "Load sidebar folders on demand" --body "## Summary
- load sidebar directories only when expanded or revealed
- refresh loaded branches without rebuilding the vault tree
- preserve complete note lookup through uncached, request-scoped enumeration
- leave full-content search unchanged

## Verification
- pnpm test
- pnpm build
- pnpm test:e2e
- cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
- cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings
- cargo test --manifest-path src-tauri/Cargo.toml --lib"
```

The PR body must summarize shallow startup, on-demand folder expansion, targeted watcher refresh, uncached note lookup, unchanged content search, and the exact verification commands that passed.
