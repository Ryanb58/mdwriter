# mdwriter — Design

**Date:** 2026-05-09
**Status:** Draft (pending review)

## 1. Overview

**mdwriter** is a fast, lightweight desktop markdown editor for writers who keep notes and posts as flat `.md` files in a folder on disk. The center pane is a block editor (BlockNote); the left pane is a file tree; the right pane is a Properties panel that edits YAML frontmatter as structured fields. Files on disk remain canonical, portable markdown — the app never owns the data.

### Goals

- **Fast:** native binary, instant startup, no perceptible lag on typing or file switching for vaults up to ~1000 notes.
- **Lightweight:** small bundle (target ≤15 MB), low memory footprint, no background services beyond a file watcher.
- **Filesystem-as-truth:** the `.md` file on disk is canonical. Cache and state are reconstructible.
- **Comfortable for writers:** auto-save, structured frontmatter editing, raw-source toggle for power use.
- **Cross-platform:** macOS, Windows, Linux.

### Non-goals (v1)

- Wikilinks, backlinks, knowledge-graph features.
- Rendered preview pane (the block editor itself is the rendered view).
- WYSIWYG inline images, drag-and-drop file moves.
- Git integration, sync, plugins, AI features.
- Multi-window or multi-folder workspaces.
- Type/schema system; frontmatter is free-form key/value YAML.

## 2. Architecture

### High-level

```
┌──────────────────────────────────────────────────────────────────┐
│                         React App (TypeScript)                   │
│ ┌──────────┐ ┌──────────────────────────────┐ ┌────────────────┐ │
│ │   Tree   │ │        Editor pane           │ │  Properties    │ │
│ │  (left)  │ │   BlockNote (default)        │ │  pane (right)  │ │
│ │          │ │   ↕ Cmd+E                    │ │  fields list   │ │
│ │ folders  │ │   CodeMirror raw mode        │ │  add/remove    │ │
│ │ + files  │ │                              │ │  field types   │ │
│ │ + ctx    │ │ breadcrumb · word count ·    │ │  (string,      │ │
│ │ menu     │ │ save indicator               │ │   date, list…) │ │
│ └──────────┘ └──────────────────────────────┘ └────────────────┘ │
│   Cmd+P palette · status bar · folder switcher (menu)            │
│              Zustand store (UI + ephemeral state)                │
└─────────────────────────────────┬────────────────────────────────┘
                                  │ tauri::invoke + events
┌─────────────────────────────────▼────────────────────────────────┐
│                        Rust (Tauri commands)                     │
│ fs::list_tree    fs::read_file    fs::write_file                 │
│ fs::create_file  fs::create_dir   fs::rename   fs::trash         │
│ fm::parse_doc    fm::serialize_doc  (gray_matter + serde_yaml)   │
│ watch::start     watch::stop      → emits "vault-changed"        │
│ recent::get/set                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Editor data flow

The `.md` file on disk is the source of truth. On open:

1. Rust reads the file and splits it into `{ frontmatter: serde_yaml::Value, body: String }`.
2. Frontend receives both. The Properties pane binds to `frontmatter`. The body string is fed into BlockNote's markdown parser (`@blocknote/core` provides `tryParseMarkdownToBlocks`).
3. User edits propagate to a Zustand slice keyed by file path (`{ frontmatter, blocks, dirty }`).
4. On idle (~500ms after the last edit) or on file switch, the save pipeline runs:
   - Serialize blocks → markdown via BlockNote (`blocksToMarkdownLossy`).
   - Serialize frontmatter → YAML via Rust.
   - Concatenate `---\n{yaml}\n---\n\n{markdown}` and write atomically (temp file + rename).
5. Status bar shows `Saving…` → `Saved`.

Markdown round-trip is "lossy" by BlockNote's design — fidelity is good for the standard set (headings, lists, code blocks, tables, quotes, links, images) but unusual constructs may normalize. This is acceptable for v1; the raw-mode toggle (Cmd+E) preserves any edit a user wants to make literally.

### Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Desktop shell | Tauri v2 | Small binary, Rust backend, native FS access. |
| Frontend | React 19 + TypeScript 5 | Already scaffolded; ecosystem fit. |
| Block editor | `@blocknote/core` + `@blocknote/react` + `@blocknote/mantine` | Production-grade block editor, markdown round-trip, customizable. |
| Raw editor | CodeMirror 6 + `@codemirror/lang-markdown` | Best-in-class source editor; only mounted in raw mode. |
| State | Zustand | Lightweight; matches "fast" goal; no provider tree. |
| Command palette | `cmdk` | Battle-tested fuzzy palette. |
| Icons | `phosphor-icons-react` | Consistent, lightweight. |
| Build | Vite | Already scaffolded. |
| Backend | Rust 2021 edition | Tauri default. |
| Frontmatter parse | `gray_matter` + `serde_yaml` | Standard YAML frontmatter handling. |
| File watcher | `notify` | Cross-platform recursive watcher. |
| Trash | `trash` crate | Cross-platform send-to-trash. |
| Tests | Vitest, Playwright (smoke), `cargo test` | Frontend, E2E, Rust unit. |

## 3. Data model

### File on disk

```markdown
---
title: My Post
date: 2026-05-09
tags:
  - draft
  - notes
---

# My Post

Body text...
```

### In-memory (frontend)

```ts
type WorkspaceState = {
  rootPath: string                  // current open folder (absolute)
  tree: TreeNode                    // loaded once, refreshed by watcher events
  selectedPath: string | null       // path of file currently open in editor
  recentFolders: string[]           // managed by Rust, mirrored here
}

type TreeNode =
  | { kind: 'dir', name: string, path: string, children: TreeNode[] }
  | { kind: 'file', name: string, path: string }    // .md/.markdown only

type OpenDoc = {
  path: string
  frontmatter: Record<string, YamlValue>      // editable map of keys → values
  blocks: PartialBlock[]                       // BlockNote document
  rawMarkdown: string                          // canonical body, kept in sync on save
  dirty: boolean
  savedAt: number | null
}

type YamlValue =
  | { type: 'string', value: string }
  | { type: 'number', value: number }
  | { type: 'boolean', value: boolean }
  | { type: 'date', value: string }            // ISO 8601
  | { type: 'list', value: YamlValue[] }
  | { type: 'null' }
  // v1 stops here; nested maps are shown as readonly raw YAML in a fallback row
```

The frontend derives a field's display type from the parsed value. Type inference rules:

- ISO date string (`YYYY-MM-DD` or RFC 3339) → `date`.
- `true` / `false` → `boolean`.
- Number literal → `number`.
- Array → `list` (recurse on elements).
- Object/map → `nested` (rendered as a collapsed read-only YAML chip; user opens raw mode to edit).
- Otherwise → `string`.

### Persisted app state (installation-local)

Stored at the OS app config directory (`tauri::path::config_dir()`):

- `recent.json` — array of recently opened folder paths (deduped, capped at 10).
- `window-state.json` — last window size/position.
- `settings.json` — placeholder for v2 (font size, theme); defaults baked in for v1.

### Rust types (commands)

```rust
#[derive(Serialize)]
struct TreeNode {
    kind: TreeKind,        // "dir" | "file"
    name: String,
    path: PathBuf,
    children: Option<Vec<TreeNode>>,  // present only for dirs
}

#[derive(Serialize, Deserialize)]
struct ParsedDoc {
    frontmatter: serde_yaml::Value,
    body: String,
}
```

## 4. User flows

### First launch

1. App boots. Rust reads `recent.json`. Empty → emits `no-recent-folder` event.
2. Frontend shows a centered "Open a folder" empty state with a single button.
3. User clicks → native folder picker (Tauri `dialog::open`).
4. Selected path becomes `rootPath`. Rust starts the watcher and scans the tree.
5. Tree appears; editor shows a centered "Select a file or create a new one" empty state.

### Subsequent launches

1. Rust reads `recent.json`, picks the most recent entry, validates it still exists.
2. If valid → start watcher, scan tree, render UI immediately. No prompt.
3. If invalid (folder moved/deleted) → fall back to the empty state from first launch.

### Switching folders

- App menu → "Open Folder…" (Cmd+Shift+O) opens picker.
- New folder pushed to top of `recent.json`. Watcher restarted on new path.
- Any unsaved doc is saved synchronously before the switch.

### Opening a file

1. User clicks a file in the tree.
2. If another doc is dirty, it's saved first.
3. Rust `fs::read_file` + `fm::parse_doc` returns `{ frontmatter, body }`.
4. Frontend builds the BlockNote document from `body`; binds frontmatter to Properties pane.
5. Tree highlights the row; breadcrumb updates.

### Editing and auto-save

1. User types or edits a property field.
2. `dirty = true`; status bar shows `●`.
3. Debounced save fires 500ms after last edit:
   - Block doc → markdown.
   - Frontmatter map → YAML string.
   - Combined string written to disk via atomic temp+rename.
4. On success: `dirty = false`, status bar shows `Saved 12:34:56`.
5. On error: toast with retry; `dirty` stays true.

### Raw-source toggle (Cmd+E)

1. User presses Cmd+E with a file open.
2. Editor pane swaps from BlockNote to CodeMirror, mounted with the current full markdown source (frontmatter + body).
3. Edits in raw mode update `rawMarkdown` directly.
4. While in raw mode, the Properties pane is shown read-only (greyed) with a banner: "Editing raw source — properties will update on switch back". This avoids dual-source-of-truth ambiguity.
5. Toggling back to block mode re-parses `rawMarkdown` into `{ frontmatter, blocks }`. The Properties pane re-binds to the freshly parsed frontmatter.
6. If parse fails (invalid YAML), block mode is blocked and an error banner appears; user stays in raw to fix.

### Tree operations

- Right-click folder → New File / New Folder / Rename / Delete / Reveal in Finder.
- Right-click file → Open / Rename / Delete / Reveal in Finder.
- New file → creates `untitled.md` and immediately enters inline rename.
- Rename → F2 or double-click; updates disk path; if file is open, updates the open doc's path.
- Delete → confirm dialog → `trash::delete`. If file was open, editor goes to empty state.

### Cmd+P fuzzy file search

1. User presses Cmd+P. Modal palette opens, focused on input.
2. Frontend uses an in-memory list of all `.md` paths under `rootPath` (built from the tree).
3. Fuzzy match (`cmdk` default) sorted by score.
4. Enter or click → opens the file.

### External file change

1. `notify` watcher fires for a path under `rootPath`.
2. Rust debounces (~150ms) and emits `vault-changed` event with `{ kind, paths[] }`.
3. Frontend:
   - For tree changes (create/delete/rename): refresh tree branch.
   - For `modify` of currently open file: if local doc is **clean**, reload it transparently. If **dirty**, show a non-blocking banner: "File changed on disk — Reload (discard local) / Keep editing".
   - Suppress events for paths the app itself just wrote (last 1s).

## 5. UI layout

Three-pane shell. Left and right panes are resizable via drag handles; right pane is hideable. Min width 480px (editor only). Default widths: tree 220px, editor flex, properties 280px.

- **Tree pane (left, 180–400px):** vault root header (folder name), file tree below. Files filtered to `.md` / `.markdown`; empty folders hidden. Right-click context menu and standard keyboard navigation (arrows, Enter to open).
- **Editor pane (center, flex):** breadcrumb bar at top with filename (clickable to rename) and word count, BlockNote surface in default mode, CodeMirror surface in raw mode (Cmd+E). Empty state when no file is open.
- **Properties pane (right, 220–500px, hideable via toggle):** filename header, list of frontmatter fields rendered by inferred type (text, number, date picker, boolean toggle, list editor). "+ Add field" button at the bottom. Each field has a remove (×) on hover.
- **Status bar (bottom, full width):** save state (●/Saving…/Saved hh:mm:ss), word count, current folder path (clickable → switch folder).
- **Cmd+P palette:** centered modal, fuzzy filename search.

Theme: dark by default; light mode behind a setting (v2 if not trivial). System font for UI; `ui-monospace` for code blocks and raw editor.

## 6. Module layout

### Rust (`src-tauri/src/`)

```
main.rs              # Tauri builder, command registration, window setup
commands/
  mod.rs             # re-exports
  fs.rs              # list_tree, read_file, write_file, create_*, rename, trash
  frontmatter.rs     # parse_doc, serialize_doc
  watch.rs           # start_watcher, stop_watcher, debouncer, vault-changed emitter
  recent.rs          # get_recent_folders, push_recent_folder
state.rs             # AppState (active vault, watcher handle)
errors.rs            # IoError, FrontmatterError → typed Tauri errors
```

Each command file ≤200 lines, single concern. Commands return `Result<T, AppError>` with serde-serializable errors.

### Frontend (`src/`)

```
main.tsx                   # Vite entry, theme bootstrap
App.tsx                    # shell: tree | editor | properties | statusbar
features/
  folder/
    EmptyFolderState.tsx
    useFolderPicker.ts     # invoke open_folder_dialog + push_recent_folder
  tree/
    TreePane.tsx
    TreeNode.tsx
    useTree.ts             # invoke list_tree, listen to vault-changed
    useTreeContextMenu.ts
  editor/
    EditorPane.tsx
    BlockEditor.tsx        # BlockNote wrapper
    RawEditor.tsx          # CodeMirror wrapper
    useEditorMode.ts       # Cmd+E toggle, parse/serialize transitions
    useAutoSave.ts         # 500ms debounce, atomic save
  properties/
    PropertiesPane.tsx
    PropertyField.tsx      # dispatches by inferred type
    fields/
      StringField.tsx
      NumberField.tsx
      BooleanField.tsx
      DateField.tsx
      ListField.tsx
      NestedField.tsx      # readonly fallback
    inferType.ts
  palette/
    CommandPalette.tsx     # Cmd+P, cmdk-based
  watcher/
    useExternalChanges.ts  # listen to vault-changed, dispatch refreshes
lib/
  store.ts                 # Zustand root + slices
  ipc.ts                   # typed wrappers around tauri::invoke
  paths.ts                 # path helpers (basename, parent, isMarkdown)
  yaml.ts                  # YamlValue inference / serialization helpers
styles/
  globals.css
  theme.css
```

Each feature folder owns its components, hooks, and styles. Inter-feature communication goes through the Zustand store. No feature imports from another feature directly.

## 7. Error handling

| Failure | Behavior |
|---|---|
| Folder picker cancelled | Stay on current state; no error. |
| Recent folder no longer exists | Fall back to empty state; remove from recents. |
| File read fails | Toast with path + retry; tree row marked with warning icon. |
| File write fails (auto-save) | Toast with retry; `dirty` stays true; subsequent edits trigger another save attempt. |
| Frontmatter parse fails on open | Open in raw mode automatically with a banner explaining the parse error. |
| Frontmatter parse fails on raw → block toggle | Block toggle blocked; banner persists until raw is valid. |
| Watcher fails to start | Disable external-change refresh; status bar warns; everything else still works. |
| External change to clean open doc | Silent reload. |
| External change to dirty open doc | Non-blocking banner: "Reload (discard local)" / "Keep editing". |
| Rename collision | Native error → toast, rename aborted. |
| Delete | Always goes to system trash; never `unlink`. |

## 8. Testing strategy

- **Rust unit (`cargo test`):**
  - `frontmatter::parse_doc` — round-trip on representative files (with/without frontmatter, nested values, lists, dates).
  - `frontmatter::serialize_doc` — preserves key order where possible (use `serde_yaml::Mapping` not `BTreeMap`).
  - `fs::list_tree` — `.md` filter, hidden file exclusion, symlink behavior, large folder.
  - `recent::push_recent_folder` — dedupe, cap at 10, ordering.
- **Rust integration:**
  - Watcher: write a file in a temp dir, assert event emitted.
  - Atomic write: simulate write failure (read-only file) → temp file cleaned up.
- **Frontend unit (Vitest):**
  - `inferType` — type inference table.
  - `yaml` helpers — YamlValue ↔ raw YAML round-trip.
  - Auto-save debouncer — fires at 500ms idle, batches consecutive edits.
- **Frontend component:**
  - PropertyField rendering for each type.
  - Tree context menu actions invoke correct command.
- **E2E (Playwright + `pnpm tauri dev` headless):**
  - Open folder → see tree → open file → edit → assert disk file updated.
  - Cmd+E toggle round-trips a non-trivial document.
  - Rename file in tree → editor breadcrumb updates → disk reflects rename.
  - Modify file externally → clean editor reloads.

## 9. Cross-platform considerations

- **Path handling:** all paths are absolute and serialized as strings. Use `Path::canonicalize` on open. Display strings in UI use OS-native separators.
- **macOS:** standard menu bar, native folder picker, Cmd-key shortcuts. Send-to-trash uses `NSFileManager`.
- **Windows:** Ctrl-key shortcuts (Tauri default `CmdOrCtrl`). Recycle bin via `trash` crate.
- **Linux:** XDG trash. Tauri 2 requires WebKit2GTK 4.1 + GTK 3 — documented in README.

## 10. Open questions / assumptions

- **BlockNote markdown fidelity:** assumed sufficient for v1's standard markdown. If a user's existing files use unusual constructs, raw mode is the escape hatch. Will flag known gaps after a manual test pass on a real folder.
- **Properties pane field-type inference:** v1 infers types; user can't force a type. If this proves limiting, v2 adds an explicit type chooser per field.
- **Performance ceiling:** designed for ~1000 notes per folder. Above that, virtual scrolling on tree and lazy directory expansion would be needed (out of scope v1).
- **Hidden files (`.git`, `.obsidian`):** excluded from tree by default. No setting to show them in v1.
- **Bundle target ≤15 MB:** plausible with Tauri + tree-shaken React + lazy-loaded CodeMirror. Verify after first build.

## 11. Acceptance criteria

mdwriter v1 is done when:

1. Launching the app on a fresh machine prompts for a folder, then remembers it.
2. The tree shows all `.md` files under the chosen folder, hides everything else.
3. Clicking a file opens it in the block editor; frontmatter appears as fields in the right pane.
4. Typing in the editor or properties saves the file to disk within 1 second of stopping.
5. Cmd+E toggles between block and raw views with no data loss on round-trip for a standard test file.
6. Cmd+P opens a fuzzy palette that jumps to any file in the workspace.
7. Right-clicking a tree row creates / renames / trashes files and folders.
8. Editing a file in another app while the workspace is open updates the tree (and the editor if the file is clean) within 1 second.
9. The release build is under 20 MB on macOS.
10. `cargo test` and `pnpm test` both pass; the Playwright smoke suite passes on macOS.
