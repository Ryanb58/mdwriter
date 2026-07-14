# Editing Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mdwriter's BlockNote and CodeMirror editing experience focused, Markdown-safe, fast to understand, and resilient against silent normalization or lost edits, without changing the centered prose layout.

**Architecture:** Keep the canonical full-file `openDoc.text` buffer and the pinned BlockNote 0.50.0 / CodeMirror 6 editors. Add a curated React UI around BlockNote rather than removing schema support; analyze source Markdown before committing a loaded document; distinguish user preference from the safe effective editor mode; route every in-memory edit through one store action; serialize all open-document writes through one latest-snapshot coordinator; and give Find an editor-specific exact target instead of sharing source-text occurrence numbers across different text domains.

**Tech Stack:** React 19, TypeScript 5.8, Zustand 5, BlockNote 0.50.0, CodeMirror 6, Tailwind 4, Vitest, Testing Library, Tauri 2 / Rust

**Branch:** `tbrazelton/editing-experience`, based on local `main` and `origin/main` at `150137d`

## Global constraints

- Keep `src/features/editor/wikilinkInline.tsx` additive; do not remove BlockNote schema types merely because their creation controls are hidden.
- Leave editor width, prose centering, focus-mode measure, and the surrounding layout unchanged.
- Every frontend write of an open note calls `noteSelfWrite(path)` immediately before `ipc.writeFile` and again after completion.
- A disk read failure never creates an editable empty `OpenDoc`.
- A system-forced raw-mode choice never changes the user's preferred mode.
- BlockNote initialization and hydration are read-only; no normalized export may dirty or save a note before a user edit.
- Only one open-document filesystem write may be active at a time. Newer edits coalesce to the latest snapshot.
- Use BlockNote 0.50.0 public APIs named below. If installed declarations differ, characterize that exact version in a test rather than widening with unbounded `any`.
- Follow red-green-refactor for each task. Observe the focused test fail for the intended reason before implementation, then rerun it green.
- Keep commits scoped to the task. Never stage `.pnpm-store/` or the temporary local `pnpm-workspace.yaml` used to restore dependencies.

---

## Task 1: Pin the BlockNote Markdown contract

**Files:**

- Create: `src/features/editor/__tests__/blocknoteMarkdownContract.test.ts`
- Read only: `src/features/editor/wikilinkInline.tsx`

**Purpose:** Turn the exact behavior of the installed BlockNote 0.50.0 converter into executable evidence before changing its UI.

- [ ] **Step 1: Add stable semantic fixtures for the supported subset**

Create an editor with the existing `editorSchema`. For each fixture, parse Markdown with `tryParseMarkdownToBlocks`, export with `blocksToMarkdownLossy`, parse the export again, and compare semantic block shapes after removing generated ids. Cover:

- headings 1-3 and paragraphs;
- bullet, numbered, and checklist items;
- a fenced code block with a language token;
- a single-paragraph quote and divider;
- links and an uncaptioned image with non-empty alt/name;
- bold, italic, strikethrough, inline code, and hard breaks;
- a rectangular GFM table with one header row.

Assert a second export/import cycle produces the same canonical Markdown as the first. Assert the table reparses with `headerRows === 1` and unchanged row/column counts.

- [ ] **Step 2: Pin known loss boundaries**

Add explicit characterization assertions that:

- a programmatic headerless table is not considered safe because reimport changes its shape;
- an image caption is lost and may become stray paragraph text;
- all runtime values from `getDefaultReactSlashMenuItems(editor)` contain a string `key`, even though the 0.50 React declaration omits it.

These are documentary tests, so they should pass against the baseline rather than start red.

- [ ] **Step 3: Run and commit**

Run: `pnpm test -- src/features/editor/__tests__/blocknoteMarkdownContract.test.ts`

Expected: PASS.

Commit: `test: characterize BlockNote markdown contract`

---

## Task 2: Build the curated slash menu and Markdown-safe table model

**Files:**

- Create: `src/features/editor/markdownSlashMenu.tsx`
- Create: `src/features/editor/markdownTables.tsx`
- Create: `src/features/editor/__tests__/markdownSlashMenu.test.ts`
- Create: `src/features/editor/__tests__/markdownTables.test.ts`

**Public contracts:**

```ts
export type KeyedSlashItem = DefaultReactSuggestionItem & { key: string }

export const MARKDOWN_SLASH_KEYS = [
  "paragraph", "heading", "heading_2", "heading_3", "quote", "code_block",
  "bullet_list", "numbered_list", "check_list", "divider", "table", "image",
] as const

export function getMarkdownSlashMenuItems(editor: BlockNoteEditor): KeyedSlashItem[]
export function filterMarkdownSlashMenuItems(
  editor: BlockNoteEditor,
  query: string,
): KeyedSlashItem[]

export type TableDeleteResult =
  | { kind: "update"; content: TableContent<any, any> }
  | { kind: "remove-table" }
  | { kind: "noop" }

export function createMarkdownTableBlock(rows?: number, columns?: number): PartialBlock
export function deleteMarkdownTableAxis(
  content: TableContent<any, any>,
  orientation: "row" | "column",
  index: number,
): TableDeleteResult
```

- [ ] **Step 1: Write failing slash-menu tests**

Assert exact item key order, group order (`Text`, `Lists`, `Insert`), retained icons/aliases/badges, public `filterSuggestionItems` behavior for aliases, and the absence of emoji, video, audio, generic file, toggle, and Heading 4-6 items. Invoke the Table item and assert it inserts a 2-by-3 rectangular table with `headerRows: 1`.

Run: `pnpm test -- src/features/editor/__tests__/markdownSlashMenu.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the pinned menu adapter**

Call `getDefaultReactSlashMenuItems(editor)`, narrow each runtime item through a checked `{ key: string }` adapter, explicitly pick `MARKDOWN_SLASH_KEYS`, overwrite only group names, and preserve title, subtext, aliases, badge, and icon. Throw a clear development-time error if an expected key is missing. Override Table's click handler with `insertOrUpdateBlockForSlashMenu(editor, createMarkdownTableBlock())`. Mount it through `SuggestionMenuController` with `triggerCharacter="/"`.

- [ ] **Step 3: Write failing table-model tests**

Assert the default factory is rectangular, has exactly one header row, and has no header columns. Assert deletion behavior:

- deleting row zero promotes the next remaining row by restoring `headerRows: 1`;
- deleting a middle row preserves all other cells;
- deleting the only row returns `remove-table`;
- deleting a column updates every row and stays rectangular;
- deleting the final column returns `remove-table`;
- an out-of-range index returns `noop`.

Run: `pnpm test -- src/features/editor/__tests__/markdownTables.test.ts`

Expected: FAIL before the pure reducer exists.

- [ ] **Step 4: Implement the table model and custom handles**

Use `TableHandlesController`, `TableHandle`, `TableHandleMenu`, `AddButton`, `useExtensionState`, and `TableHandlesExtension`. Apply reducer results with `editor.updateBlock` or `editor.removeBlocks`. The handle menu exposes add-before/add-after and delete only; the cell handle renders nothing. Keep row/column dragging and the controller's extend/trim affordance, but provide no colors, header toggles, merges, or splits.

- [ ] **Step 5: Verify and commit**

Run both focused files, then:

`pnpm test -- src/features/editor/__tests__/blocknoteMarkdownContract.test.ts src/features/editor/__tests__/markdownSlashMenu.test.ts src/features/editor/__tests__/markdownTables.test.ts`

Commit: `feat: curate markdown insertion and tables`

---

## Task 3: Replace BlockNote's default editing chrome

**Files:**

- Create: `src/features/editor/MarkdownEditorUi.tsx`
- Create: `src/features/editor/__tests__/markdownEditorUi.test.tsx`
- Modify: `src/features/editor/BlockEditor.tsx`

**Public contracts:**

```ts
export type ToolbarKind = "inline" | "image" | "file" | "none"
export function classifyFormattingSelection(
  blocks: readonly { type: string; content?: unknown }[],
): ToolbarKind

export function isUnsupportedMarkdownShortcut(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey" | "code" | "key">,
): boolean
```

- [ ] **Step 1: Write failing pure and component tests**

Assert:

- text/list/heading/quote/code selections classify as `inline`;
- one image classifies as `image`;
- one audio/video/file classifies as `file`;
- divider/table/mixed unsupported selections classify as `none`;
- the block selector order is Paragraph, H1, H2, H3, Quote, Code block, Bullet, Numbered, Checklist;
- Mod+U and Mod+Shift+6 match on macOS and non-macOS modifiers;
- plain U and Mod+Shift+7/8/9 remain available;
- side-menu composition contains Add, Drag, and Delete but no Colors;
- the formatting toolbar exposes only Bold, Italic, Strike, Code, Link for inline selections; Replace/Delete for image; Delete for other files; and no shell for `none`.

Run: `pnpm test -- src/features/editor/__tests__/markdownEditorUi.test.tsx`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement explicit toolbar and side menu composition**

Use `FormattingToolbarController`, `FormattingToolbar`, `BlockTypeSelect`, the installed `blockTypeSelectItems`, `BasicTextStyleButton`, `CreateLinkButton`, `FileReplaceButton`, and `FileDeleteButton`. Reuse installed dictionary-backed block choices and add Code block with a narrow local icon adapter if needed. Branch before mounting `FormattingToolbar` so a selection with no safe controls returns `null`.

Use `SideMenuController`, `SideMenu`, `AddBlockButton`, `DragHandleButton`, `DragHandleMenu`, and `RemoveBlockItem`. Preserve dragging and insertion, with Delete as the only dropdown command.

- [ ] **Step 3: Install unsupported-shortcut capture**

Attach a capture-phase keydown handler to the BlockNote host. Prevent and stop only Mod+U and Mod+Shift+6 before ProseMirror receives them. Do not block the supported Markdown list shortcuts.

- [ ] **Step 4: Integrate all controllers in `BlockEditor`**

Set these `BlockNoteView` props to false:

```tsx
formattingToolbar={false}
sideMenu={false}
slashMenu={false}
emojiPicker={false}
tableHandles={false}
```

Leave link toolbar and file panel enabled by omission. Mount `MarkdownFormattingToolbar`, `MarkdownSideMenu`, `MarkdownSlashMenuController`, and `MarkdownTableHandles` as children. Create the editor with:

```ts
tables: {
  splitCells: false,
  cellBackgroundColor: false,
  cellTextColor: false,
  headers: false,
}
```

Do not alter the schema or layout classes.

- [ ] **Step 5: Verify and commit**

Run the focused UI/menu/table tests and `pnpm build`.

Commit: `feat: simplify BlockNote editing controls`

---

## Task 4: Make BlockNote hydration read-only

**Files:**

- Create: `src/features/editor/blockEditorHydration.ts`
- Create: `src/features/editor/__tests__/blockEditorHydration.test.ts`
- Create: `src/features/editor/__tests__/BlockEditor.initialization.test.tsx`
- Modify: `src/features/editor/BlockEditor.tsx`

**Contract:**

```ts
export type HydrationGate = {
  generation: number
  readyGeneration: number | null
  suppressedGeneration: number | null
}

export function createHydrationGate(): HydrationGate
export function beginHydration(gate: HydrationGate): number
export function isCurrentHydration(gate: HydrationGate, generation: number): boolean
export function runWithHydrationSuppressed(
  gate: HydrationGate,
  generation: number,
  fn: () => void,
): void
export function finishHydration(gate: HydrationGate, generation: number): void
export function canEmitHydrationChange(gate: HydrationGate, generation: number): boolean
```

- [ ] **Step 1: Write the gate tests red**

Assert a new generation is not emit-ready, callbacks during suppressed replacement are rejected, `finishHydration` enables the current generation, generation two invalidates generation one, a stale finish cannot re-enable old work, and an async export captured under the old generation is rejected after a file switch.

- [ ] **Step 2: Implement the generation gate**

Keep it framework-free and mutable behind the component's ref so it can be tested without React.

- [ ] **Step 3: Write the integration regression red**

Mock editor creation and `BlockNoteView`. Make `replaceBlocks` synchronously invoke the captured `onChange`, and make the exporter return normalized Markdown. Mount non-empty initial Markdown and assert `onChangeMarkdown` is never called. Then simulate a user change after hydration and assert exactly one callback.

- [ ] **Step 4: Integrate the gate**

Begin before parsing, reject stale parse results, wrap `replaceBlocks` in suppression, and finish even for empty content. Capture a generation in `onChange`; check `canEmitHydrationChange` before export and again after awaiting `blocksToMarkdownLossy`. A new doc key invalidates all older async work.

- [ ] **Step 5: Verify and commit**

Run both focused files and all Task 1-3 editor tests.

Commit: `fix: keep BlockNote hydration read-only`

---

## Task 5: Detect Markdown constructs that need raw preservation

**Files:**

- Create: `src/lib/markdownRisks.ts`
- Create: `src/lib/__tests__/markdownRisks.test.ts`

**Contract:**

```ts
export type MarkdownRiskCode =
  | "html-comment"
  | "footnote"
  | "reference-definition"
  | "link-title"
  | "mdx"
  | "raw-html"
  | "inline-html"
  | "math"
  | "directive"
  | "table-alignment"
  | "code-fence-metadata"
  | "multi-paragraph-quote"
  | "ambiguous-frontmatter"
  | "frontmatter-error"

export type MarkdownRisk = { code: MarkdownRiskCode; label: string }
export function detectMarkdownRisks(body: string): MarkdownRisk[]
```

- [ ] **Step 1: Write a positive corpus red**

Add one focused fixture for every code: comments, references, footnotes, link/image titles, JSX/MDX, raw/inline HTML, display math and math fences, directives, table alignment markers, code-fence metadata after the language token, multi-paragraph quotes, and an unmatched leading frontmatter fence.

- [ ] **Step 2: Write a negative corpus red**

Assert no false positives for the same syntax inside fenced code, indented code, variable-length inline code spans, or escaped syntax. Assert currency `$5`, comparisons using `<`, URI/email autolinks, ordinary one-paragraph quotes, plain fenced-code language tokens, normal GFM tables without alignment colons, and well-closed frontmatter are safe.

- [ ] **Step 3: Implement a masking scanner**

Normalize line endings only for scanning, preserving offsets is unnecessary because the result is code-based. Mask fenced code first, then indented code, then inline code spans while preserving newlines. Run anchored line rules over the masked form and inline rules over each remaining line. Deduplicate by code and return risks in a stable declaration order.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- src/lib/__tests__/markdownRisks.test.ts`

Commit: `feat: detect markdown compatibility risks`

---

## Task 6: Add atomic document analysis, safe opening, and mode continuity

**Files:**

- Create: `src/lib/documentAnalysis.ts`
- Create: `src/lib/__tests__/documentAnalysis.test.ts`
- Create: `src/features/editor/__tests__/useOpenFile.test.tsx`
- Create: `src/features/editor/__tests__/useEditorMode.test.tsx`
- Create: `src/features/editor/MarkdownCompatibilityBanner.tsx`
- Create: `src/features/editor/DocumentLoadState.tsx`
- Create: `src/features/editor/__tests__/MarkdownCompatibilityBanner.test.tsx`
- Modify: `src/lib/store.ts`
- Modify: `src/features/editor/useOpenFile.ts`
- Modify: `src/features/watcher/useExternalChanges.ts`
- Modify: `src/features/editor/useEditorMode.ts`
- Modify: `src/features/editor/EditorPane.tsx`
- Modify: `src/features/properties/PropertiesPane.tsx`
- Modify: `src/features/ai/applyToNote.ts`
- Modify tests for those consumers.

**State additions:**

```ts
export type SaveStatus = "clean" | "queued" | "saving" | "error"

export type OpenDoc = {
  path: string
  text: string
  dirty: boolean
  savedAt: number | null
  parseError: string | null
  markdownRisks: MarkdownRisk[]
  contentFingerprint: string
  saveStatus: SaveStatus
  saveError: string | null
}

export type LoadError = { path: string; message: string }

preferredEditorMode: EditorMode
editorMode: EditorMode
loadError: LoadError | null
blockModeOverrides: Record<string, string>

openAnalyzedDocument(path: string, text: string, source: "disk" | "external"): void
editOpenDoc(nextText: string): void
requestEditorMode(mode: EditorMode): "changed" | "blocked"
overrideBlockModeForCurrentDoc(): void
```

`blockModeOverrides[path]` stores the lightweight fingerprint it authorizes. None of the new session state belongs in `partialize`.

- [ ] **Step 1: Write pure analyzer tests red**

`analyzeDocument(path, text)` uses `parseDoc`, runs risks over the Markdown body, appends a named `frontmatter-error` risk only for a structural parser error, and computes a deterministic non-cryptographic fingerprint from the full text. It must not flag preserved-but-unmodeled complex YAML merely because the Properties pane cannot infer it.

- [ ] **Step 2: Write store transition tests red**

Assert:

- safe load uses `preferredEditorMode` as effective mode;
- risky load commits `openDoc` and raw effective mode in one Zustand update;
- a risky load never exposes a transient block-mode state;
- requesting block on an unoverridden risky doc returns `blocked`;
- a blocked explicit block request records block as the preference for the next safe note while keeping the current effective mode raw;
- override changes only effective mode and is keyed by path/fingerprint;
- local edits recompute analysis, set `dirty`, set `saveStatus` queued unless already saving, clear save error, and refresh the override fingerprint;
- an external replacement invalidates an old fingerprint override;
- rename remaps the override;
- the next safe note restores the preferred mode.

- [ ] **Step 3: Implement analysis and invariant-preserving actions**

Centralize construction of `OpenDoc`. Replace direct edit patches in `EditorPane`, `PropertiesPane`, and `applyToOpenDoc` with `editOpenDoc(nextText)`. Retain `patchOpenDoc` only for lifecycle metadata and path remaps, not content edits.

- [ ] **Step 4: Write open/read failure tests red**

Mock `ipc.readFile`. Assert a successful risky read opens raw immediately, while a rejected read leaves the prior dirty note in place and sets `loadError` for the selected path. With no prior note, the rejected read renders no editable surface. Assert Retry reissues the read and clears the error only after success.

- [ ] **Step 5: Route every disk replacement through the analyzer**

Use the same atomic helper from `useOpenFile` and `useExternalChanges`. Do not construct `{ text: "" }` on failure. External clean reloads cancel queued work before replacement; in-flight writes are awaited/handled by the save coordinator in Task 8.

- [ ] **Step 6: Guard every mode request and render the compatibility banner**

Both segmented buttons and Cmd/Ctrl+E call `requestEditorMode`. A blocked block-mode request keeps raw active and leaves the persistent banner's `Edit in block mode anyway` action as the sole override path. Name detected constructs in the banner. Recompute the banner during raw edits but automatically force raw only on disk/open replacement, not mid-typing.

- [ ] **Step 7: Verify and commit**

Run the analyzer, store, open-file, watcher, mode, properties, and AI apply focused tests.

Commit: `feat: guard lossy markdown editing`

---

## Task 7: Improve raw-mode continuity

**Files:**

- Modify: `src/features/editor/RawEditor.tsx`
- Modify: `src/features/editor/BlockEditor.tsx`
- Modify: `src/App.css`
- Create or modify: `src/features/editor/__tests__/RawEditor.test.tsx`
- Modify: `src/features/editor/__tests__/BlockEditor.initialization.test.tsx`

- [ ] **Step 1: Write the raw editor test red**

Capture CodeMirror extensions and assert `EditorView.lineWrapping` is installed alongside line numbers, Markdown support, wikilink extensions, image paste, and existing selection updates.

- [ ] **Step 2: Add wrapping and focus restoration**

Install `EditorView.lineWrapping`. The existing `.cm-content { flex-shrink: 0 !important; }` rule overrides CodeMirror wrapping, so add the narrow `.cm-content.cm-lineWrapping { flex-shrink: 1 !important; min-width: 0; }` exception without changing any width or prose-measure rule. After either editor mounts for an explicit mode switch, focus its editable surface on the next animation frame. Do not translate cursor or scroll offsets between editors.

- [ ] **Step 3: Verify and commit**

Run the raw/block focused tests and `pnpm build`.

Commit: `feat: improve raw editor continuity`

---

## Task 8: Serialize saves and expose truthful lifecycle state

**Files:**

- Rewrite: `src/lib/writeDoc.ts`
- Create: `src/lib/__tests__/writeDoc.test.ts`
- Modify: `src/features/editor/useAutoSave.ts`
- Modify: `src/features/statusbar/StatusBar.tsx`
- Create: `src/features/statusbar/__tests__/StatusBar.test.tsx`

**Coordinator contract:**

```ts
export type SaveSnapshot = { path: string; text: string }

export function scheduleOpenDocSave(snapshot: SaveSnapshot): void
export function flushOpenDocSave(path?: string): Promise<void>
export function retryOpenDocSave(): Promise<void>
export function cancelQueuedOpenDocSave(path?: string): void
export function remapOpenDocSavePath(from: string, to: string): void
export function resetSaveCoordinatorForTests(): void

export type OpenDocPathMutation = {
  remap(fromRoot: string, toRoot: string): void
  discard(roots: readonly string[]): void
  release(): void
}

export function beginOpenDocPathMutation(
  affectedRoots: readonly string[],
): Promise<OpenDocPathMutation>
```

Internal state holds one active promise/snapshot, one coalesced latest queued snapshot, debounce readiness, and the latest failed snapshot. No second `ipc.writeFile` starts until the active promise settles.

`beginOpenDocPathMutation` pauses automatic pumping, flushes an affected open note, and returns a guard. Edits made while rename/move/trash IPC is pending remain queued behind the pause. On success, `remap` or `discard` updates coordinator path state; `release` resumes pumping. This closes the race where typing during a slow path mutation could recreate the old path.

- [ ] **Step 1: Write coordinator tests red with deferred promises**

Assert:

- a normal edit enters queued, then saving, then clean;
- edits during a write coalesce to the latest text;
- the second write does not start until the first settles;
- success for an old snapshot never clears newer dirty text;
- retry writes the latest snapshot, not the failed one;
- a failure keeps `dirty`, enters error, stores a display-safe message, and stops automatic advancement;
- a new edit after failure clears the error and starts a fresh debounce;
- flush waits for queued and active work and rejects on failure;
- cancel removes only work that has not started;
- every started write stamps `noteSelfWrite` before and after IPC.

Use fake timers for debounce and manually controlled promises for write order.

- [ ] **Step 2: Implement a latest-snapshot state machine**

Compare successful `{ path, text }` against current `openDoc` before marking clean. If newer text exists, keep dirty and either return to queued or start a ready queued write. Map thrown errors to a short message safe for UI while retaining the original in console logging/toast.

- [ ] **Step 3: Wire autosave and close behavior**

`useAutoSave` schedules only via the coordinator. The close handler calls `event.preventDefault()` while awaiting the flush; after success it explicitly closes/destroys according to Tauri's close-request API without recursively bypassing safety. On failure it keeps the window open with the error state intact.

- [ ] **Step 4: Write and implement status-bar states**

Assert exact UI:

- queued: `Unsaved`, no spinner;
- saving: spinner and `Saving…`;
- clean with timestamp: existing Saved presentation;
- error: persistent `Save failed` plus Retry button.

Retry calls `retryOpenDocSave()` immediately and remains disabled while saving.

- [ ] **Step 5: Verify and commit**

Run write coordinator, autosave, and status tests.

Commit: `feat: serialize note saves and add retry`

---

## Task 9: Await persistence before navigation and path mutations

**Files:**

- Modify: `src/features/editor/useOpenFile.ts`
- Modify: `src/features/folder/useFolderPicker.ts`
- Modify: `src/features/editor/renameOpenDoc.ts`
- Modify: `src/features/tree/moveExecutor.ts`
- Modify: `src/features/tree/useTreeActions.ts`
- Modify: `src/features/watcher/useExternalChanges.ts`
- Modify: `src/features/editor/__tests__/renameOpenDoc.test.ts`
- Modify: `src/features/tree/__tests__/moveExecutor.test.ts`
- Create: `src/features/tree/__tests__/treeSaveGuards.test.ts`
- Modify: `src/features/watcher/__tests__/useExternalChanges.test.ts`

**Shared helpers:**

```ts
export function pathIsWithin(path: string, root: string): boolean
export function remapOpenDocumentPath(from: string, to: string): void
```

- [ ] **Step 1: Write navigation failure tests red**

When selecting another file while the current note is dirty, assert the old path is flushed before the new read/commit. If flush rejects, keep the original open note, preserve selected bytes and save error, and cancel replacement.

- [ ] **Step 2: Write rename/move/trash tests red**

For the open path and every ancestor folder operation, assert the filesystem mutation waits for `beginOpenDocPathMutation`. On failure assert rename/move/trash IPC is not called. While mutation IPC is pending, make a new edit and assert it remains queued rather than writing the old path. On success assert the guard, open document, selected paths, pending find target, and compatibility override are remapped together before release. For trash, clear/discard state only after a successful flush and trash.

- [ ] **Step 3: Implement shared guards and remapping**

Replace direct `ipc.writeFile` in `renameOpenDoc` with the path-mutation guard. Apply the same guard to breadcrumb rename, auto-rename, inline tree rename, drag move, trash, and switching vault folders. Await each operation before mutating state, call `remap` or `discard` only after filesystem success, and always `release` in `finally`. Keep unrelated batch items movable when they do not contain the open path, but abort an affected batch before its first rename when flushing fails. A failed vault switch leaves root, watcher, selection, and the open document unchanged.

- [ ] **Step 4: Clarify external replacement behavior**

An accepted watcher replacement may cancel queued-not-started work. It must never claim to cancel an active write. If the active write belongs to the same path, await it before rereading or ignore the echo based on `noteSelfWrite` as appropriate.

- [ ] **Step 5: Verify and commit**

Run all navigation/path mutation/watcher tests and the save coordinator test.

Commit: `fix: protect unsaved notes during file operations`

---

## Task 10: Clarify wikilink navigation

**Files:**

- Create: `src/features/editor/linkAffordance.ts`
- Create: `src/features/editor/__tests__/linkAffordance.test.ts`
- Modify: `src/features/editor/wikilinkInline.tsx`
- Modify: `src/features/editor/wikilinkCM.ts`
- Modify: `src/features/editor/__tests__/useLinkActivation.test.tsx`
- Modify: `src/features/editor/__tests__/wikilinkCM.test.ts`
- Modify: `src/features/editor/__tests__/wikilinkRoundtrip.test.ts`

- [ ] **Step 1: Write behavior tests red inside real `contenteditable` hosts**

Assert a bare click places/keeps the caret and does not navigate; Cmd-click on macOS and Ctrl-click elsewhere navigate resolved links; the wrong modifier does not; unresolved links never navigate. Assert resolved titles are `Open notes/example.md (Cmd-click)` or `(Ctrl-click)` and unresolved titles are `Note not found: target`.

- [ ] **Step 2: Add a shared tooltip formatter**

Use `modifierClickLabel(platform?)` and `wikilinkTooltip(target, resolvedRel, platform?)` from the same pure formatter in BlockNote inline rendering and CodeMirror decoration widgets. Guard `navigator.platform` for non-browser tests. Preserve existing link resolution and broken/resolved styling. Do not add creation or change plain-click editing behavior.

- [ ] **Step 3: Verify and commit**

Run all wikilink and activation tests.

Commit: `feat: clarify wikilink navigation`

---

## Task 11: Give Find exact, editor-specific targets

**Files:**

- Modify: `src/lib/store.ts`
- Modify: `src/features/palette/SearchMode.tsx`
- Rewrite: `src/features/editor/blockTextSearch.ts`
- Modify: `src/features/editor/FindBar.tsx`
- Modify: `src/features/editor/BlockEditor.tsx`
- Modify: `src/features/editor/RawEditor.tsx`
- Rewrite: `src/features/editor/scrollViewToMatch.ts`
- Create: `src/features/editor/rawFindHighlight.ts`
- Create: `src/features/editor/blockFindHighlight.ts`
- Modify: `src/App.css`
- Modify: `src/features/editor/__tests__/blockTextSearch.test.ts`
- Modify: `src/features/editor/__tests__/findInText.test.ts`
- Create: `src/features/editor/__tests__/rawFindHighlight.test.ts`
- Create: `src/features/editor/__tests__/blockFindHighlight.test.ts`
- Create or modify: `src/features/editor/__tests__/FindBar.test.tsx`

**Typed targets:**

```ts
export type VaultRevealTarget = {
  kind: "vault-reveal"
  path: string
  line: number
  matchText: string
  occurrence: number
}

export type RawFindTarget = {
  kind: "find-raw"
  path: string
  from: number
  to: number
  requestId: number
}

export type BlockFindTarget = {
  kind: "find-block"
  path: string
  blockId: string
  from: number
  to: number
  requestId: number
}

export type PendingScroll = VaultRevealTarget | RawFindTarget | BlockFindTarget

export type RenderedBlockEntry = { blockId: string; text: string }
export type RenderedBlockMatch = RenderedBlockEntry & { from: number; to: number }

export type BlockTextIndex = {
  path: string
  docKey: string
  blocks: RenderedBlockEntry[]
}
```

Add ephemeral `blockTextIndex: BlockTextIndex | null` plus `setBlockTextIndex`; never persist it. `SearchMode` only adds the `kind: "vault-reveal"` discriminant to its current payload, preserving its existing fallback and focus behavior.

- [ ] **Step 1: Write rendered-index tests red**

Replace `findNthBlockMatch` expectations with a pure display-order index. Cover repeated matches, multiple matches in one block, nested blocks, links using visible label not URL, wikilinks using alias/target, formatted inline spans, and case-insensitive non-overlapping ranges. Every result carries exact character offsets.

- [ ] **Step 2: Publish the active BlockNote index**

While BlockEditor is mounted, derive `{ blockId, text }[]` from `editor.document`, publish it for the active path/doc revision, and refresh after editor changes. Clear it on unmount/path change. `FindBar` computes block-mode totals only from this index, never raw Markdown.

- [ ] **Step 3: Add CodeMirror exact-range decorations**

Create a `StateEffect<{from:number;to:number}|null>` and `StateField<DecorationSet>`. Navigation dispatches the effect plus `EditorView.scrollIntoView` but does not change selection or call `view.focus()`. Clear on query close, note change, replacement, and timeout.

- [ ] **Step 4: Add BlockNote exact overlays**

Locate the rendered block by stable block id. Walk its text nodes in DOM order, map `from/to` to a `Range`, and render pointer-events-none absolutely positioned rectangles from `getClientRects()`. Do not mutate ProseMirror DOM. If mapping fails, call existing `flashHighlight` on the whole block.

- [ ] **Step 5: Refactor FindBar lifecycle**

For raw mode, use `findOccurrences(doc.text, query)` to build absolute ranges. For block mode, use rendered index matches. Keep vault-search reveal behavior as its own union branch. Reset index on path change, clamp it after edits, keep focus in the Find input, preserve editor selection, and clear exact highlights immediately on close or empty query.

- [ ] **Step 6: Verify and commit**

Run all find/search focused tests, including `SearchMode` regression coverage.

Commit: `feat: highlight exact find matches`

---

## Task 12: Full verification, manual pass, and branch review

**Files:**

- Modify only files required by failures found in verification.
- Update: `docs/superpowers/plans/2026-07-14-editing-experience.md` checkboxes if work is tracked in-file.

- [ ] **Step 1: Run formatting/type/build verification**

Run:

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm build
```

Expected: 0 failures and a successful Vite production build.

- [ ] **Step 2: Run focused regression groups again**

Run editor UI/contract, Markdown risk, document opening/modes, save coordinator/path mutation, wikilink, and Find tests individually so a full-suite pass is not masking leaked timers or shared state.

- [ ] **Step 3: Manual Tauri pass**

Run `pnpm tauri dev` and verify:

1. selection toolbar and drag menu have no colors, underline, alignment, captions, or generic media actions;
2. plus, drag/reorder, delete, curated slash items, image insertion, and one-header-row tables work;
3. `:` does not open emoji, Mod+U does not underline, and supported Markdown shortcuts still work;
4. opening a safe note does not dirty it; risky source opens raw with the named warning and explicit override;
5. preferred mode returns on the next safe note; raw prose wraps; editor focus returns after a mode switch;
6. save display walks Unsaved → Saving → Saved, and a simulated failure stays visible and retries;
7. dirty navigation/rename/move/trash cannot discard or recreate old-path content;
8. wikilink titles explain modifier click and modifier-click opens only resolved targets;
9. Find highlights exact repeated occurrences in both modes without stealing input focus;
10. editor width and centering are unchanged.

- [ ] **Step 4: Review the diff and clean temporary artifacts**

Confirm `git diff main...HEAD --check`, inspect `git status --short`, and move any temporary `.pnpm-store/` or local workspace config out of the repository without staging it. Check that no unrelated user changes are included.

- [ ] **Step 5: Request code review**

Use `superpowers:requesting-code-review` with the design spec, this plan, base `150137d`, and final feature-branch head. Resolve Critical/Important findings with focused tests.

- [ ] **Step 6: Re-run verification before completion**

Use `superpowers:verification-before-completion`, rerun the full commands from Step 1, and report exact counts/output. Then use `superpowers:finishing-a-development-branch` to present integration options; do not merge or push unless the user asks.

Commit any verification-driven fixes separately with a descriptive message.
