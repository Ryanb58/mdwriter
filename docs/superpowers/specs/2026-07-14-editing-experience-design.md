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
- Avoid schema-removal failures for existing BlockNote shapes while being explicit that Markdown cannot preserve every BlockNote-only style or media type.
- Prevent known unsupported Markdown constructs from being silently simplified in block mode.
- Make raw mode suitable for prose and preserve the user's preferred mode while moving between notes.
- Show whether a note is waiting to save, actively saving, saved, or in an error state.
- Make wikilink navigation requirements apparent instead of making normal clicks appear broken.
- Highlight the exact in-note search match instead of an entire block or line.

## 3. Non-goals

- Changing editor width, centering prose, or introducing a new reading measure.
- Replacing BlockNote or CodeMirror.
- Making BlockNote's Markdown conversion lossless.
- Performing full semantic validation of arbitrary YAML frontmatter.
- Removing block or style types from the BlockNote schema.
- Sanitizing or rewriting existing colored content.
- Preserving the exact caret offset when switching between block and raw modes.
- Adding backlinks, graph views, or a broader wikilink redesign.
- Adding new attachment types beyond the existing image workflow.

## 4. Design principles

### Markdown is the product contract

Controls should reflect the CommonMark and GFM subset that mdwriter can import and export predictably. The block editor may remain visually rich, but it must not imply that unsupported presentation details will be saved.

### Hide capabilities before removing data support

The first pass customizes BlockNote's React UI while leaving the underlying schema intact. Existing colored blocks, embedded content, or uncommon BlockNote structures remain representable in memory instead of becoming unknown-node failures. This does not override the Markdown exporter's persistence limits. The normal creation controls expose only the tested subset.

### System-forced mode changes do not overwrite user preference

The app may open a risky note in raw mode to protect its source. That safety decision must not change the mode the user selected for ordinary notes.

### Save state must describe reality

"Saving" is reserved for an active filesystem write. A debounced edit is "Unsaved," and a failed write remains visibly failed until it succeeds or a new edit queues another attempt.

## 5. Markdown-safe BlockNote UI

### 5.1 Component boundary

Create a focused editor UI module under `src/features/editor/`, separate from `BlockEditor.tsx`. It owns five pieces:

- `MarkdownFormattingToolbar`
- `MarkdownDragHandleMenu`
- `MarkdownSideMenu`
- `MarkdownSlashMenuController`
- `MarkdownTableHandles`

`BlockEditor.tsx` remains responsible for editor creation, Markdown parsing/export, image paste, search jumps, and selection publication. It sets `formattingToolbar={false}`, `sideMenu={false}`, `slashMenu={false}`, `emojiPicker={false}`, and `tableHandles={false}` on `BlockNoteView`, then mounts the custom controllers as children. The link toolbar and image file panel remain enabled.

### 5.2 Formatting toolbar

The floating selection toolbar contains:

- A curated block type selector containing Paragraph, Heading 1-3, Quote, Code block, Bullet list, Numbered list, and Checklist
- Bold
- Italic
- Strikethrough
- Inline code
- Link

For an image block selection, it may show only the controls that are meaningful to the existing image workflow and stable in BlockNote 0.50.0:

- Replace image
- Delete image block

For an existing audio, video, or generic-file block, show Delete only. Do not offer Replace because mdwriter's upload pipeline accepts images only.

The toolbar branches on the selected block type before mounting BlockNote's toolbar shell:

- Inline-content blocks render the curated block selector and text controls.
- Image blocks render replace and delete.
- Existing audio, video, and generic-file blocks render delete only.
- Divider, table, and other node selections render no floating toolbar.

This outer branch is required because BlockNote's file buttons are capability-based rather than image-specific, and an empty `FormattingToolbar` still produces a visible shell. The block selector uses an explicit item list; BlockNote's default selector contains block types intentionally omitted from mdwriter's curated slash menu.

The toolbar omits:

- Text and background colors
- Underline
- Left, center, and right alignment
- Nest and unnest buttons
- Comments
- File captions
- Generic file rename, download, or preview actions

Keyboard shortcuts and input rules for the exposed Markdown subset remain available. Intercept the installed unsupported creation shortcuts, including Mod+U for underline and Mod+Shift+6 for toggle lists, so hiding those commands does not leave a second normal path to create them. The schema still recognizes existing underline/style/toggle data; this change only removes creation affordances.

### 5.3 Block side menu

Keep BlockNote's hover-only `+` button and drag handle. Replace the drag-handle dropdown with a menu containing Delete only. Dragging the handle continues to reorder blocks.

The Colors submenu and table-header actions are removed from this generic per-block menu. Safe table operations remain available through mdwriter's custom table handles.

### 5.4 Slash menu

Replace the default `/` controller with a `SuggestionMenuController` using `triggerCharacter="/"`. The menu contains, in this order:

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

The image file panel, custom table handles, and link toolbar stay available because the curated menu still exposes images, tables, and links.

The Table item does not use BlockNote 0.50.0's default insertion behavior. It inserts a simple rectangular table with `headerRows: 1`, the form verified to round-trip through this pinned Markdown converter. Mount custom table handles that keep row/column add, delete, and reordering while omitting header toggles, cell colors, merges, and splits. If the first row is deleted, the next remaining row is promoted immediately by restoring `headerRows: 1`; deleting the table's only row removes the table block. This prevents users from converting the table back into a headerless or non-rectangular form that 0.50.0 cannot preserve reliably.

The implementation builds an explicitly ordered item list and then uses BlockNote's public suggestion filtering. It does not rely on the default menu order. BlockNote 0.50.0's React helper retains runtime item keys that its declared type omits; the implementation may use a narrow, documented local keyed type for this pinned version, backed by a contract test, or use the core keyed items and provide React icons locally. Either approach must retain aliases, badges, icons, grouping, and query filtering.

### 5.5 Schema compatibility

The existing schema in `wikilinkInline.tsx` remains additive and unchanged apart from any type imports needed by the new UI. This keeps existing BlockNote content recognizable in memory and avoids adding a schema-removal failure on top of Markdown conversion. It does not promise that BlockNote-only styles or media types can survive a Markdown save/reopen cycle.

The retained schema continues to provide:

- Existing colored content
- Image parsing and paste behavior
- Code-block syntax highlighting
- Custom wikilink inline content
- Parsing of files that contain block types no longer offered by the menu

Block editor initialization is read-only. Programmatic `replaceBlocks` during parse/hydration must be covered by an initialization generation/suppression guard so its BlockNote `onChange` event cannot export normalized Markdown and mark the note dirty before the user edits. Add a regression test that mounting and initializing a note never calls `onChangeMarkdown`.

## 6. Markdown compatibility guard

### 6.1 Supported block-mode contract

Block mode is limited to the subset characterized against the installed BlockNote 0.50.0 converter:

- Headings and paragraphs
- Ordered, unordered, and task lists
- Simple rectangular GFM tables with one header row
- Fenced code blocks
- Blockquotes
- Links and uncaptioned images with a non-empty name/alt value
- Bold, italic, strikethrough, inline code, and hard breaks

Known 0.50.0 failures are excluded from creation controls: headerless tables gain a row on reimport, image captions become stray paragraphs and disappear as captions, and audio, video, generic-file, toggle, color, and alignment semantics are lossy. The app does not attempt a byte-for-byte parse/export comparison because harmless syntax normalization would create excessive warnings. Instead, it pins characterization tests for the exposed subset and uses a pure risk detector for source constructs known to need raw preservation.

### 6.2 Risk detector

Add a pure `detectMarkdownRisks(body)` helper. It returns stable risk codes and user-facing labels for:

- HTML comments
- Footnotes and footnote definitions
- Reference-style link or image definitions
- Inline link or image titles
- MDX/JSX-style tags or expressions
- Raw HTML blocks
- Inline HTML tags, excluding autolinks
- Math fences or display-math delimiters
- Directive/container syntax such as `:::`
- GFM table alignment markers
- Fenced-code metadata beyond the language token
- Multi-paragraph blockquotes that 0.50.0 collapses
- An ambiguous leading `---` fence with no closing frontmatter fence

Detection must be conservative around ordinary prose. For example, a currency `$` does not count as math, and an inline comparison using `<` does not count as an HTML block. Unit tests define the accepted and rejected patterns.

The scanner ignores constructs inside fenced or indented code blocks, inline-code spans, and escaped syntax. Line-oriented constructs such as reference definitions, footnotes, directives, and HTML blocks use anchored patterns so examples in ordinary sentences do not trigger the guard. Inline HTML detection excludes URI and email autolinks such as `<https://example.com>`.

The detector is a safety net, not a claim of complete Markdown validation. The raw editor remains available for any source the user wants to preserve literally.

### 6.3 Open behavior

When a note opens:

1. Read and parse the file as today.
2. Run the risk detector against the Markdown body.
3. Commit the loaded document and its effective editor mode to the store in one transaction. A risky note must never mount BlockNote for an intermediate render.
4. If the frontmatter parser reports an actual structural failure, include it as a named compatibility risk and default to raw mode. An explicit block-mode override remains available because the source bytes are still preserved separately from the body. Complex or unmodeled YAML that the current lenient value parser preserves is not treated as invalid merely because the Properties pane cannot model it.
5. If risks are present and the note has not been overridden for this session, open it in raw mode.
6. Show a persistent, non-blocking banner naming the detected constructs.
7. Offer `Edit in block mode anyway`. Choosing it records a session-only override for that path and switches the effective mode to block without changing `preferredEditorMode`.

The warning never edits the document. Risks and frontmatter structure are recomputed from the current text, so fixing the envelope or removing all detected risky syntax in raw mode updates the guard without requiring a reload. Automatic raw-mode selection happens on file load or external replacement, never in the middle of typing. Overrides are not persisted across app launches.

An override is keyed by path plus a lightweight content fingerprint. Local edits update the active override's fingerprint so it remains valid while the user works; an external replacement at the same path invalidates it. Rename remaps the override to the new path. This prevents permission granted to an earlier version of a note from silently applying to unrelated replacement content.

All ways of replacing a loaded file from disk, including the external watcher, use the same analysis-and-open helper. All in-memory text edits use one store action that sets `dirty`, advances the save lifecycle, clears stale save errors, and recomputes frontmatter structure and Markdown risks. Migrate the current editor, Properties pane, and AI apply paths to that action so none can bypass these invariants.

A filesystem read failure is not a frontmatter error and must never create an editable blank `OpenDoc`. Track a separate display-safe load error for the selected path and render a non-editable Retry state. When navigation starts from a dirty note, await its coordinated flush before replacing `OpenDoc`; if that save fails, keep the original note open in its error state and cancel the navigation rather than discarding the only in-memory copy.

## 7. Block/raw mode continuity

### 7.1 Preferred and effective mode

Split the current single mode concept into:

- `preferredEditorMode`: the session-scoped mode explicitly selected by the user.
- `editorMode`: the effective mode rendered for the current note.

User toggles update both values. Opening an ordinary note sets the effective mode to the preferred mode. A compatibility or frontmatter guard may force the effective mode to raw without changing the preference. Opening the next compatible note restores the preferred mode.

Every block-mode request, including the segmented control and Cmd/Ctrl+E shortcut, passes through the same guard. A risky note without an override stays raw and directs the user to the banner's explicit `Edit in block mode anyway` action; creating that override does not alter the preferred mode.

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

- Edit with no active write: `dirty = true`, `saveStatus = "queued"`, clear the prior error.
- Edit during an active write: `dirty = true`, keep `saveStatus = "saving"`, remember the newest queued snapshot, and clear the prior error.
- Debounce fires: `saveStatus = "saving"`.
- Write succeeds and the current text still equals the written snapshot: `dirty = false`, `saveStatus = "clean"`, update `savedAt`.
- Write succeeds but newer text exists: keep `dirty = true`; transition to `queued` if its debounce is still pending, otherwise immediately begin the ready queued write.
- Write fails: keep `dirty = true`, set `saveStatus = "error"`, preserve a display-safe error.
- Retry: immediately write the latest path and text with `saveStatus = "saving"`.

Every write continues to call `noteSelfWrite(path)` immediately before `ipc.writeFile`, and again after the write lands, preserving the current watcher contract.

### 8.2 Status-bar presentation

- `queued`: subdued `Unsaved`; no spinner.
- `saving`: spinner with `Saving…`.
- `clean` with `savedAt`: existing saved timestamp presentation.
- `error`: persistent danger-styled `Save failed` and a Retry action.

The existing error toast remains useful as an immediate notification, but it is not the only record of failure. A failed state cannot display an indefinite saving spinner.

### 8.3 Serialized save queue

The save coordinator permits only one filesystem write at a time for the open-document workflow. Edits that arrive during a write coalesce into the newest queued `{ path, text }` snapshot; once the active write settles and the debounce is ready, that newest snapshot writes next. This prevents an older slow write from landing after a newer one and leaving stale bytes on disk.

If the active write fails, stop automatic queue advancement and retain the newest snapshot. Retry writes that latest snapshot, not the older failed bytes. A subsequent edit is also an explicit new scheduling event: it clears the old error and starts a fresh debounce for the newest content.

Save completion also compares the written `{ path, text }` snapshot with the current open document before marking it clean. This prevents an older successful write from clearing the dirty flag or updating `savedAt` for edits made while that write was in flight.

### 8.4 Explicit write paths

Keep debounce, queue ownership, `noteSelfWrite`, status transitions, and error mapping in `lib/writeDoc.ts`. Its explicit operations cover:

- Schedule the latest open-document snapshot.
- Flush queued work and return a promise that settles when that path's active write is complete.
- Retry the latest failed snapshot immediately.
- Cancel queued-but-not-started work before an accepted external reload.

Flush-on-close awaits the latest bytes and keeps the window open if persistence fails. Navigation away from a dirty note awaits the old path's flush before replacing it; a clean note can switch immediately. Every path mutation that affects the open note or an ancestor folder—breadcrumb rename, auto-rename, tree inline rename, drag move, and trash—must await the coordinated flush before changing the filesystem, so a late save cannot recreate the old path. Successful rename/move operations remap the open document, queued path state, find state, and compatibility override together. External watcher handling may cancel queued work, but never claims to cancel a filesystem write that already started.

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

Raw Markdown and rendered block text are different search domains: link destinations and syntax delimiters exist in source but not in the visible BlockNote text. Refactor `findNthBlockMatch` into a rendered-text index that walks `editor.document` in display order and records each block's `{ blockId, text }`. While block mode is mounted, publish that ephemeral index for the active path/revision and refresh it after editor changes. `FindBar` uses this index for its block-mode total, selected occurrence, and target, so all three agree.

Each match target includes the block id plus exact character offsets in `extractBlockText(block)`. Map that character range across the rendered block's text nodes. After scrolling the target block into view, build a DOM `Range` and draw pointer-events-none overlay rectangles over the exact matching characters using `Range.getClientRects()`.

The overlay does not mutate ProseMirror-managed DOM. It clears when another result is selected, the note changes, the query closes, or its short highlight timeout expires. If the range cannot be mapped because the block rerendered, fall back to the existing whole-block flash rather than failing navigation.

### 10.2 Raw editor

Add a small CodeMirror state effect and decoration field for the active find range. Search navigation sets that decoration and scrolls it into view without moving the editor selection or focus away from the Find input. The decoration clears under the same conditions as the block-editor overlay.

### 10.3 Find-bar lifecycle

Make pending scroll a typed union that distinguishes an exact in-note Find target from a vault-search reveal. Find requests carry the editor-specific exact range and preserve the input's focus and the editor's selection; vault-search reveal requests keep their current text/occurrence fallback and cursor/focus behavior. This prevents both search domains from sharing an occurrence number with incompatible semantics, and it keeps the exact-highlight work from weakening palette-to-editor navigation.

Changing notes resets the current result index and recomputes matches against the new document. Document edits clamp the index to the available result count. Closing the Find bar clears its active decoration or overlay immediately. Search continues to respect the current editor mode and never forces a mode switch.

## 11. Component and data-flow summary

```text
Open file
  -> parse full document
  -> detect Markdown risks
  -> choose effective editor mode
      -> BlockNote + Markdown-safe UI
      -> CodeMirror + line wrapping

Editor change
  -> invariant-preserving editOpenDoc action
  -> analyze frontmatter structure + Markdown risks
  -> dirty + queued
  -> debounce
  -> serialized saving
  -> clean, queued-for-newer-edit, or persistent error

Find request
  -> active editor's source or rendered-text index
  -> editor-specific exact-range renderer
  -> clear on next request, close, or note change
```

The filesystem-backed `openDoc.text` remains the only canonical document copy. The block find index is derived, session-only UI state and is discarded when its editor unmounts.

## 12. Error and edge-case behavior

| Case | Behavior |
|---|---|
| Existing in-memory BlockNote content contains colors | Keep schema support while mounted and expose no creation controls; Markdown save/reopen remains lossy. |
| Existing source parses to a hidden slash-menu block type | Render it where the schema supports it; removing its creation command does not itself mutate or save the note. |
| Image selected with custom text toolbar | Show only replace and delete controls; never an empty toolbar shell or lossy caption control. |
| Existing audio, video, or generic-file block selected | Show Delete only; do not route it through the image replacement pipeline. |
| Risk detector finds unsupported syntax | Open raw, show named risks, allow a session-only override. |
| Frontmatter envelope is structurally ambiguous or reports a parse failure | Default to raw with a named risk; allow the same explicit session override. |
| File read fails | Show a non-editable Retry state; never open an empty writable buffer for that path. |
| Risky file is loading while block mode is preferred | Analyze before the store update; never mount BlockNote for an intermediate frame. |
| Save fails | Keep dirty bytes in memory, show persistent Retry, and retain the toast. |
| New edit occurs after save failure | Clear the old error and queue the latest snapshot. |
| Slow save finishes after a newer edit | Do not mark the newer text clean. |
| A newer save becomes ready while an older save is active | Serialize them and write the newest queued snapshot after the older write settles. |
| User navigates away while the note is dirty | Await the flush; if it fails, keep the note open with Retry and cancel navigation. |
| User closes the window while the final save fails | Keep the window open with the in-memory note and failure state intact. |
| Open file or ancestor is renamed, moved, or trashed during an active save | Await the coordinated flush before the path mutation so the old path cannot be recreated; block the mutation if persistence fails. |
| Exact block match cannot map to DOM text | Fall back to whole-block highlighting. |
| Find query has no results after an edit or file switch | Show zero results and clear any prior highlight. |

## 13. Implementation slices

The detailed implementation plan should split the work into independently verifiable slices:

1. Pin BlockNote 0.50.0 characterization fixtures and define the Markdown-safe toolbar, block selector, table, and slash-menu contracts from their results.
2. Mount the custom BlockNote formatting, side, drag-handle, slash, and table UI; disable the emoji picker and suppress initialization-originated changes.
3. Add the pure Markdown risk detector, code-span/fence masking, and its syntax corpus.
4. Add the shared document analyzer, separate load-error state, invariant-preserving edit action, preferred/effective modes, atomic raw-mode forcing, the compatibility banner, and fingerprinted session overrides.
5. Add CodeMirror line wrapping and focus restoration.
6. Introduce the save lifecycle, serialized latest-snapshot queue, awaited flushes, persistent failure UI, and Retry.
7. Clarify wikilink modifier navigation and strengthen contenteditable interaction tests.
8. Implement exact-range find feedback in CodeMirror and BlockNote, including fallback behavior.
9. Run focused tests, the complete frontend suite, Rust unit tests, a production build, and a manual Tauri editing pass.

These slices may be committed separately so regressions can be isolated and reviewed.

## 14. Testing strategy

### Pure unit tests

- Allowed formatting-selector and slash-menu item sets, order, grouping, filtering, and absence of dead Emoji/media commands.
- BlockNote 0.50.0 characterization fixtures for the exposed subset and known lossy exclusions.
- Markdown risk detector positive and negative corpus.
- Save-status state transitions, coalescing, serialized writes, stale completion, retry, and awaited flush behavior.
- Navigation, rename, move, trash, and close behavior when an awaited flush succeeds or fails.
- Find result indexing and reset/clamp behavior.

### Component and behavior tests

- Formatting toolbar branches correctly by selection type and contains no color, underline, caption, or alignment controls.
- Unsupported BlockNote shortcuts such as Mod+U and Mod+Shift+6 do not create lossy styles or toggle blocks.
- Drag-handle menu retains Delete and excludes Colors.
- Custom table controls preserve one header row, including after deleting the first row, and expose no color/header/merge/split actions.
- Safe note opens in the preferred mode.
- Risky note opens directly in raw without an intermediate BlockNote mount; override opens block; next safe note restores the preference.
- A frontmatter structural risk defaults to raw but can be explicitly overridden, while complex preserved YAML is not falsely rejected.
- A file read failure shows a non-editable load error and never an editable blank note.
- Status bar renders Unsaved, Saving, Saved, and Save failed with Retry.
- Resolved, broken, bare-click, and modifier-click wikilinks inside `contenteditable`.
- Find clears or resets when the active document changes.
- Block editor initialization and hydration do not emit a document edit or schedule a save.

### Editor integration tests

- Markdown-safe formatting round-trips through `blocksToMarkdownLossy` for bold, italic, strike, code, links, headings, lists, tasks, single-paragraph quotes, simple one-header-row tables, plain fenced code blocks, dividers, and uncaptioned named images. Assert semantic block equivalence after reimport and stable canonical Markdown after a second export/import cycle.
- Custom image toolbar still replaces and deletes an image without exposing caption editing.
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
4. Mounting the editor or removing creation controls does not itself mutate, dirty, or save a note; no persistence guarantee is made for BlockNote-only semantics that Markdown 0.50.0 cannot represent.
5. Known risky Markdown opens in raw mode with a clear explanation and an explicit session-only block-mode override.
6. Frontmatter structural risks default safely to raw without treating preserved complex YAML as invalid.
7. A user's preferred block/raw mode survives note navigation unless a safety guard temporarily forces raw mode.
8. Long raw Markdown lines wrap within the current editor viewport.
9. Save feedback accurately distinguishes queued, saving, saved, and failed states, and failed saves can be retried.
10. A slow older save cannot mark newer unsaved text clean or land after a newer save; the latest snapshot wins on disk.
11. Wikilink tooltips explain modifier-click navigation and unresolved targets.
12. In-note Find visually identifies the exact occurrence in both editor modes and resets correctly across note changes.
13. Editor width, prose centering, and the existing content measure remain unchanged.
14. Frontend tests, Rust unit tests, and the production frontend build pass.
15. File read failures cannot expose an editable blank buffer that could overwrite the original note.
16. A failed final flush blocks note replacement, rename, move, trash, or window close so the only in-memory copy is not discarded.
