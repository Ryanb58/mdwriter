# mdwriter Editing Experience Improvements

**Date:** 2026-07-14
**Status:** Draft, pending written-spec review

## 1. Overview

mdwriter uses BlockNote 0.50.0 for its block editor and CodeMirror 6 for raw Markdown. The current BlockNote view enables the library's complete default UI even though mdwriter saves plain Markdown through BlockNote's lossy Markdown exporter. As a result, the editor offers controls such as colors, underline, alignment, toggle blocks, and generic media uploads that either do not survive Markdown export or do not match mdwriter's image-only file pipeline.

This initiative makes the editor feel like a focused Markdown notes app without replacing BlockNote, changing the on-disk format, or removing schema support needed to read existing notes. It also improves raw-mode continuity, save-state accuracy, link discoverability, and in-note find feedback.

The existing editor width, prose centering, content measure, and horizontal layout will not change. The user explicitly excluded that proposal.

## 2. Goals

- Present only controls that have a reliable meaning in mdwriter's Markdown files.
- Remove the per-block color command while preserving block insertion, dragging, reordering, and deletion.
- Keep existing notes readable, including notes that already contain BlockNote color or media data.
- Prevent known unsupported Markdown constructs from being silently simplified in block mode.
- Make raw mode suitable for prose and preserve the user's preferred mode while moving between notes.
- Show whether a note is waiting to save, actively saving, saved, or in an error state.
- Make wikilink navigation requirements apparent instead of making normal clicks appear broken.
- Highlight the exact in-note search match instead of an entire block or line.

## 3. Non-goals

- Changing editor width, centering prose, or introducing a new reading measure.
- Replacing BlockNote or CodeMirror.
- Making BlockNote's Markdown conversion lossless.
- Removing block or style types from the BlockNote schema.
- Sanitizing or rewriting existing colored content.
- Preserving the exact caret offset when switching between block and raw modes.
- Adding backlinks, graph views, or a broader wikilink redesign.
- Adding new attachment types beyond the existing image workflow.

## 4. Design principles

### Markdown is the product contract

Controls should reflect the CommonMark and GFM subset that mdwriter can import and export predictably. The block editor may remain visually rich, but it must not imply that unsupported presentation details will be saved.

### Hide capabilities before removing data support

The first pass customizes BlockNote's React UI while leaving the underlying schema intact. Existing colored blocks, embedded content, or uncommon BlockNote structures can still render. Users simply cannot create more unsupported formatting through mdwriter's normal controls.

### System-forced mode changes do not overwrite user preference

The app may open a risky note in raw mode to protect its source. That safety decision must not change the mode the user selected for ordinary notes.

### Save state must describe reality

"Saving" is reserved for an active filesystem write. A debounced edit is "Unsaved," and a failed write remains visibly failed until it succeeds or a new edit queues another attempt.

## 5. Markdown-safe BlockNote UI

### 5.1 Component boundary

Create a focused editor UI module under `src/features/editor/`, separate from `BlockEditor.tsx`. It owns four pieces:

- `MarkdownFormattingToolbar`
- `MarkdownDragHandleMenu`
- `MarkdownSideMenu`
- `MarkdownSlashMenuController`

`BlockEditor.tsx` remains responsible for editor creation, Markdown parsing/export, image paste, search jumps, and selection publication. It disables the corresponding BlockNote defaults and mounts these custom controls as children of `BlockNoteView`.

### 5.2 Formatting toolbar

The floating selection toolbar contains:

- Block type selector
- Bold
- Italic
- Strikethrough
- Inline code
- Link

For an image block selection, it may show only the controls that are meaningful to the existing image workflow:

- Edit caption
- Replace image
- Delete image block

For an existing audio, video, or generic-file block, show Delete only. Do not offer Replace because mdwriter's upload pipeline accepts images only.

The toolbar omits:

- Text and background colors
- Underline
- Left, center, and right alignment
- Nest and unnest buttons
- Comments
- Generic file rename, download, or preview actions

Keyboard behavior supplied by BlockNote remains available. Removing a toolbar button does not disable standard Markdown input rules or existing keyboard shortcuts.

### 5.3 Block side menu

Keep BlockNote's hover-only `+` button and drag handle. Replace the drag-handle dropdown with a menu containing Delete only. Dragging the handle continues to reorder blocks.

The Colors submenu and table-header actions are removed from this generic per-block menu. Table-specific operations remain available through BlockNote's table handles.

### 5.4 Slash menu

Replace the default `/` controller with a curated controller. The menu contains, in this order:

1. Text
   - Paragraph
   - Heading 1
   - Heading 2
   - Heading 3
   - Quote
   - Code block
2. Lists
   - Bullet list
   - Numbered list
   - Checklist
3. Insert
   - Divider
   - Table
   - Image

The menu excludes toggle headings, toggle lists, headings 4-6, emoji, video, audio, and generic files. Items retain icons, aliases, keyboard badges, and query filtering.

The default `:` emoji picker is disabled. The Emoji slash item is also absent, avoiding a command that opens an unmounted picker.

The image file panel, table handles, and link toolbar stay enabled because the curated menu still exposes images, tables, and links.

### 5.5 Schema compatibility

The existing schema in `wikilinkInline.tsx` remains additive and unchanged apart from any type imports needed by the new UI. This preserves:

- Existing colored content
- Image parsing and paste behavior
- Code-block syntax highlighting
- Custom wikilink inline content
- Parsing of files that contain block types no longer offered by the menu

## 6. Markdown compatibility guard

### 6.1 Supported block-mode contract

Block mode is intended for the subset BlockNote documents as its common Markdown support:

- Headings and paragraphs
- Ordered, unordered, and task lists
- Tables
- Fenced code blocks
- Blockquotes
- Links and images
- Bold, italic, strikethrough, inline code, and hard breaks

The app does not attempt a byte-for-byte parse/export comparison because harmless syntax normalization would create excessive warnings. Instead, it uses a pure risk detector for constructs known to need raw preservation.

### 6.2 Risk detector

Add a pure `detectMarkdownRisks(body)` helper. It returns stable risk codes and user-facing labels for:

- HTML comments
- Footnotes and footnote definitions
- Reference-style link or image definitions
- MDX/JSX-style tags or expressions
- Raw HTML blocks
- Math fences or display-math delimiters
- Directive/container syntax such as `:::`

Detection must be conservative around ordinary prose. For example, a currency `$` does not count as math, and an inline comparison using `<` does not count as an HTML block. Unit tests define the accepted and rejected patterns.

The detector is a safety net, not a claim of complete Markdown validation. The raw editor remains available for any source the user wants to preserve literally.

### 6.3 Open behavior

When a note opens:

1. Read and parse the file as today.
2. Run the risk detector against the Markdown body.
3. If frontmatter parsing failed, raw mode is mandatory until the YAML is fixed.
4. If risks are present and the note has not been overridden for this session, open it in raw mode.
5. Show a persistent, non-blocking banner naming the detected constructs.
6. Offer `Edit in block mode anyway`. Choosing it records a session-only override for that path and switches the effective mode to block without changing `preferredEditorMode`.

The warning never edits the document. Risks are recomputed from the current Markdown body, so removing all detected risky syntax in raw mode clears the warning. Overrides are not persisted across app launches.

## 7. Block/raw mode continuity

### 7.1 Preferred and effective mode

Split the current single mode concept into:

- `preferredEditorMode`: the session-scoped mode explicitly selected by the user.
- `editorMode`: the effective mode rendered for the current note.

User toggles update both values. Opening an ordinary note sets the effective mode to the preferred mode. A compatibility or frontmatter guard may force the effective mode to raw without changing the preference. Opening the next compatible note restores the preferred mode.

Neither value is added to the persisted Zustand slice. A fresh app launch starts in block mode, matching current behavior.

### 7.2 Raw editor behavior

Add CodeMirror's line-wrapping extension so prose wraps within the current raw-editor viewport. Keep line numbers, Markdown language support, wikilink decoration/completion, image paste, and search navigation unchanged.

When switching into either editor, focus returns to the editor surface after mount. Exact caret and scroll-position translation between BlockNote and CodeMirror is explicitly deferred.

## 8. Save lifecycle and retry

### 8.1 State model

Keep `openDoc.dirty` as the authoritative "memory differs from disk" flag because watcher behavior depends on it. Add a separate save lifecycle:

```ts
type SaveStatus = "clean" | "queued" | "saving" | "error"
```

`OpenDoc` also carries an optional display-safe save error message. State transitions are:

- Edit: `dirty = true`, `saveStatus = "queued"`, clear the prior error.
- Debounce fires: `saveStatus = "saving"`.
- Write succeeds and the current text still equals the written snapshot: `dirty = false`, `saveStatus = "clean"`, update `savedAt`.
- Write succeeds but newer text exists: keep `dirty = true`; the newer scheduled save owns the next state.
- Write fails: keep `dirty = true`, set `saveStatus = "error"`, preserve a display-safe error.
- Retry: immediately write the latest path and text with `saveStatus = "saving"`.

Every write continues to call `noteSelfWrite(path)` immediately before `ipc.writeFile`, and again after the write lands, preserving the current watcher contract.

### 8.2 Status-bar presentation

- `queued`: subdued `Unsaved`; no spinner.
- `saving`: spinner with `Saving…`.
- `clean` with `savedAt`: existing saved timestamp presentation.
- `error`: persistent danger-styled `Save failed` and a Retry action.

The existing error toast remains useful as an immediate notification, but it is not the only record of failure. A failed state cannot display an indefinite saving spinner.

### 8.3 Concurrency correctness

Save completion must compare the written `{ path, text }` snapshot with the current open document before marking it clean. This prevents an older slow write from clearing the dirty flag for edits made while that write was in flight.

Flush-on-close, flush-on-path-change, rename, and external-change cancellation continue to route through `lib/writeDoc.ts`.

## 9. Wikilink affordance

Navigation remains Cmd-click on macOS and Ctrl-click elsewhere so an ordinary click can position the caret for editing.

Improve discoverability without changing that interaction:

- Resolved wikilinks expose a tooltip such as `Open notes/example.md (Cmd-click)`.
- Broken wikilinks expose `Note not found: target`.
- Link styling continues to distinguish resolved and broken targets.
- Tests exercise links inside an actual `contenteditable`, including bare click, modifier-click, and unresolved targets.

This initiative does not add automatic note creation or change link resolution rules.

## 10. Exact find feedback

### 10.1 Block editor

Continue using `findNthBlockMatch`, including its `localIndex`. After scrolling the target block into view, build a DOM `Range` by walking text nodes within the rendered block. Draw pointer-events-none overlay rectangles over the exact matching characters using `Range.getClientRects()`.

The overlay does not mutate ProseMirror-managed DOM. It clears when another result is selected, the note changes, the query closes, or its short highlight timeout expires. If the range cannot be mapped because the block rerendered, fall back to the existing whole-block flash rather than failing navigation.

### 10.2 Raw editor

Add a small CodeMirror state effect and decoration field for the active find range. Search navigation sets that decoration and scrolls it into view without moving focus away from the Find input. The decoration clears under the same conditions as the block-editor overlay.

### 10.3 Find-bar lifecycle

Changing notes resets the current result index and recomputes matches against the new document. Document edits clamp the index to the available result count. Search continues to respect the current editor mode and never forces a mode switch.

## 11. Component and data-flow summary

```text
Open file
  -> parse full document
  -> detect Markdown risks
  -> choose effective editor mode
      -> BlockNote + Markdown-safe UI
      -> CodeMirror + line wrapping

Editor change
  -> patch canonical openDoc.text
  -> dirty + queued
  -> debounce
  -> saving
  -> clean, queued-for-newer-edit, or persistent error

Find request
  -> occurrence lookup
  -> editor-specific exact-range renderer
  -> clear on next request, close, or note change
```

The filesystem remains canonical. No additional document copy is introduced.

## 12. Error and edge-case behavior

| Case | Behavior |
|---|---|
| Existing note contains colors | Render it; do not expose controls to add more colors. |
| Existing note contains a hidden slash-menu block type | Parse and render it where the existing schema supports it. |
| Image selected with custom text toolbar | Show only caption, replace, and delete controls; never an empty toolbar shell. |
| Existing audio, video, or generic-file block selected | Show Delete only; do not route it through the image replacement pipeline. |
| Risk detector finds unsupported syntax | Open raw, show named risks, allow a session-only override. |
| Frontmatter is invalid | Stay in raw until fixed; block-mode override is unavailable. |
| Save fails | Keep dirty bytes in memory, show persistent Retry, and retain the toast. |
| New edit occurs after save failure | Clear the old error and queue the latest snapshot. |
| Slow save finishes after a newer edit | Do not mark the newer text clean. |
| Exact block match cannot map to DOM text | Fall back to whole-block highlighting. |
| Find query has no results after an edit or file switch | Show zero results and clear any prior highlight. |

## 13. Implementation slices

The detailed implementation plan should split the work into independently verifiable slices:

1. Define and test the Markdown-safe toolbar and slash-menu contracts.
2. Mount the custom BlockNote formatting, side, drag-handle, and slash UI; disable the emoji picker.
3. Add the pure Markdown risk detector and its syntax corpus.
4. Add preferred/effective editor modes, raw-mode forcing, the compatibility banner, and session overrides.
5. Add CodeMirror line wrapping and focus restoration.
6. Introduce the save lifecycle, snapshot-safe completion, persistent failure UI, and Retry.
7. Clarify wikilink modifier navigation and strengthen contenteditable interaction tests.
8. Implement exact-range find feedback in CodeMirror and BlockNote, including fallback behavior.
9. Run focused tests, the complete frontend suite, Rust unit tests, a production build, and a manual Tauri editing pass.

These slices may be committed separately so regressions can be isolated and reviewed.

## 14. Testing strategy

### Pure unit tests

- Allowed slash-menu item set, order, grouping, filtering, and absence of dead Emoji/media commands.
- Markdown risk detector positive and negative corpus.
- Save-status state transitions and stale-write completion.
- Find result indexing and reset/clamp behavior.

### Component and behavior tests

- Formatting toolbar contains the approved controls and no color, underline, or alignment controls.
- Drag-handle menu retains Delete and excludes Colors.
- Safe note opens in the preferred mode.
- Risky note opens raw; override opens block; next safe note restores the preference.
- Invalid frontmatter cannot be overridden into block mode.
- Status bar renders Unsaved, Saving, Saved, and Save failed with Retry.
- Resolved, broken, bare-click, and modifier-click wikilinks inside `contenteditable`.
- Find clears or resets when the active document changes.

### Editor integration tests

- Markdown-safe formatting round-trips through `blocksToMarkdownLossy` for bold, italic, strike, code, links, headings, lists, tasks, quotes, tables, code blocks, dividers, and images.
- Custom image toolbar still replaces and deletes an image.
- Raw editor wraps long prose without removing line numbers or wikilink decorations.
- Exact find highlighting handles repeated matches, formatted inline spans, and multiple matches in one block or line.

### Full verification

- `pnpm test`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `pnpm build`
- Manual Tauri pass covering menus, raw/block navigation, autosave failure/retry where practical, links, and Find.

## 15. Acceptance criteria

1. No text-color or background-color selector appears in the floating formatting toolbar or per-block drag menu.
2. Block insertion, dragging, reordering, and deletion still work.
3. The slash menu contains only the approved Markdown-note items, and typing `:` does not open an emoji picker.
4. Existing notes containing hidden styles or block types are not rewritten merely because their creation controls were removed.
5. Known risky Markdown opens in raw mode with a clear explanation and an explicit session-only block-mode override.
6. Invalid frontmatter remains protected in raw mode until corrected.
7. A user's preferred block/raw mode survives note navigation unless a safety guard temporarily forces raw mode.
8. Long raw Markdown lines wrap within the current editor viewport.
9. Save feedback accurately distinguishes queued, saving, saved, and failed states, and failed saves can be retried.
10. A slow older save cannot mark newer unsaved text clean.
11. Wikilink tooltips explain modifier-click navigation and unresolved targets.
12. In-note Find visually identifies the exact occurrence in both editor modes and resets correctly across note changes.
13. Editor width, prose centering, and the existing content measure remain unchanged.
14. Frontend tests, Rust unit tests, and the production frontend build pass.
