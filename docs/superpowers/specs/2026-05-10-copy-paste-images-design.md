# Copy-Paste Images — Design

**Date:** 2026-05-10
**Status:** Draft (pending review)

## 1. Overview

Adds support for getting images into a note without leaving the editor: paste a clipboard bitmap (screenshot), paste/drag-drop an image file from Finder/Explorer, or paste an `https://` image URL. Bitmap and file sources are written to a configurable location in the vault and inserted into the markdown as a relative `![](path)` reference. URL pastes are inserted as remote `![](url)` with no fetch. Works in both block mode (BlockNote) and raw mode (CodeMirror).

### Goals

- Paste a screenshot → image lands in the vault and shows up in the note immediately.
- Drop a file from Finder → same result.
- No interruption: no naming prompts, no format dialogs.
- Both editor modes behave identically.
- Stored markdown is portable plain markdown — relative paths, no app-specific URI scheme on disk.

### Non-goals (v1)

- Re-encoding (PNG → WebP/JPEG), resizing, quality adjustment.
- Orphaned-asset cleanup (image referenced by no note).
- "Save remote URL locally" right-click.
- Image rename / move from inside the editor (use the tree pane as today).
- Slack/Word-style mixed paste with embedded images interleaved with text — only image-shaped items are intercepted; everything else goes through BlockNote's default paste path.

## 2. Decisions locked in

| Decision | Choice |
|---|---|
| Image directory | Configurable: `vault-assets`, `sibling-assets`, `same-folder`. Default `vault-assets`. |
| `vault-assets` resolves to | `<vault>/assets/` |
| `sibling-assets` resolves to | `<note-dir>/<note-stem>.assets/` |
| `same-folder` resolves to | `<note-dir>/` |
| Filename | `YYYY-MM-DD-HHMMSS-<4hex>.<ext>` (local time). Example: `2026-05-10-143052-a3f1.png`. |
| Collisions | Append `-1`, `-2`, … (in practice the random hex makes this near-impossible). |
| Bitmap format | Save native clipboard bytes. No conversion. |
| Finder file paste/drop | Always copied into the configured location. Source file untouched. |
| URL paste | Block mode: BlockNote inserts a remote image block. Raw mode: pasted as plain text (user wraps with `![]()` themselves). No fetch in either case. |
| Inserted link form | Path relative to the current markdown file's directory, POSIX separators (`/`). |
| Alt text | Empty. |
| Mode coverage | Both block mode and raw mode. |

## 3. Architecture

The work splits cleanly into three pieces:

1. **One shared TypeScript helper** that knows how to: pick a directory, name the file, write the bytes, and compute the inserted relative path.
2. **BlockNote integration** via the editor's built-in `uploadFile` + `resolveFileUrl` hooks — no custom paste handlers needed for block mode.
3. **Raw mode integration** via a small `paste` + `drop` handler on the CodeMirror host that calls the same helper and inserts `![](path)` at the cursor.

Plus a single new Rust command for binary writes, and one new settings field.

```
┌─────────────────────────────────────────────────────────────┐
│                React (existing editor surface)              │
│ ┌─────────────────────┐         ┌─────────────────────────┐ │
│ │   BlockEditor       │         │     RawEditor           │ │
│ │  ↳ uploadFile()     │         │  ↳ paste/drop listener  │ │
│ │  ↳ resolveFileUrl() │         │  ↳ insert ![](path)     │ │
│ └──────────┬──────────┘         └───────────┬─────────────┘ │
│            └──────────┬─────────────────────┘               │
│                       ▼                                     │
│              lib/imagePaste.ts                              │
│   resolveImageDir() · generateFilename() · saveImage()      │
│   relativeFromDoc()  · mimeToExt()                          │
└───────────────────────┬─────────────────────────────────────┘
                        │ ipc.writeImage(path, bytes)
                        ▼
       Rust: commands::fs::write_image  (atomic, mkdir -p)
```

### Display URLs vs. stored URLs

The **stored** form in the markdown file is always a relative path like `assets/2026-05-10-143052-a3f1.png`. The **displayed** form inside the editor must be a URL the webview can load; for filesystem paths inside a Tauri webview that means `convertFileSrc(absolutePath)` which produces `asset://localhost/...` (or `https://asset.localhost/...` on Windows).

- `BlockEditor`'s `resolveFileUrl(stored)` converts a stored URL/path into a displayable one:
  - Begins with `http://` or `https://` → return as-is.
  - Otherwise resolve to absolute against the current doc dir, then `convertFileSrc(absolute)`.
- `RawEditor` doesn't render images, so this is moot in raw mode.

The Tauri asset protocol must be enabled with a scope that covers the user's vault. v1 uses a broad scope (`**`) declared in `tauri.conf.json`; tightening to per-vault dynamic scope is a future improvement (note in §10).

## 4. Module layout

### New files

```
src/lib/
  imagePaste.ts                  # core helper (pure TS, framework-agnostic)
  __tests__/imagePaste.test.ts

src/features/editor/
  useRawImagePaste.ts            # raw mode paste/drop hook

src-tauri/src/commands/
  (extend fs.rs with write_image)
```

### Modified files

```
src/lib/store.ts                 # add imagesLocation to Settings
src/lib/ipc.ts                   # add writeImage wrapper
src/features/editor/BlockEditor.tsx
                                 # wire uploadFile + resolveFileUrl
src/features/editor/RawEditor.tsx
                                 # consume useRawImagePaste
src/features/settings/SettingsPanel.tsx
                                 # add "Image storage location" segmented control
src-tauri/src/commands/fs.rs     # add write_image command
src-tauri/src/lib.rs             # register write_image in invoke_handler
src-tauri/tauri.conf.json        # enable assetProtocol with broad scope
src-tauri/capabilities/default.json
                                 # any permission additions for asset protocol
```

## 5. Public API

### `src/lib/imagePaste.ts`

```ts
export type ImagesLocation = "vault-assets" | "sibling-assets" | "same-folder"

export type SaveImageInput = {
  bytes: Uint8Array
  mime: string                    // "image/png", "image/jpeg", …
  vaultRoot: string               // absolute
  docPath: string                 // absolute path of the current .md
  location: ImagesLocation
}

export type SaveImageResult = {
  absolutePath: string            // where the file was written
  relativePath: string            // path relative to the doc's directory,
                                  // POSIX separators, for embedding in markdown
}

export async function saveImage(input: SaveImageInput): Promise<SaveImageResult>

// Exposed for unit tests:
export function resolveImageDir(
  vaultRoot: string, docPath: string, location: ImagesLocation,
): string
export function generateFilename(mime: string, now?: Date, rand?: () => string): string
export function relativeFromDocDir(docPath: string, absolutePath: string): string
export function mimeToExt(mime: string): string | null   // null = unknown / refuse
```

Supported extensions (everything else returns `null` → caller toasts and aborts):

```
image/png  → png
image/jpeg → jpg
image/gif  → gif
image/webp → webp
image/svg+xml → svg
image/avif → avif
image/bmp  → bmp
```

### `src/lib/ipc.ts`

```ts
writeImage: (path: string, bytes: Uint8Array) => invoke<void>("write_image", { path, bytes: Array.from(bytes) }),
```

Tauri serializes `Vec<u8>` from a number array. The wrapper hides that detail.

### Rust: `commands::fs::write_image`

```rust
#[tauri::command]
pub fn write_image(path: PathBuf, bytes: Vec<u8>) -> Result<()>
```

Behavior:

- If `path` exists → return `AppError::Io("already exists: …")`. (Filenames carry a 4-hex suffix; collisions should be rare. Caller retries with a fresh name.)
- Create parent directory recursively if missing.
- Atomic write: temp sibling file → fsync → rename. Same pattern as `write_atomic` for text files; factor a shared `write_bytes_atomic` helper.

### `src/lib/store.ts` — Settings extension

```ts
export type Settings = {
  // existing fields…
  imagesLocation: ImagesLocation     // default "vault-assets"
}
```

Default `"vault-assets"` in `DEFAULT_SETTINGS`. Persisted in the existing localStorage `partialize` — no new persistence machinery.

## 6. Behavior

### Block mode (BlockNote)

BlockNote's image block accepts a URL; on paste or drop of an image, it calls the editor's `uploadFile(file: File)` and uses the returned string as the block's URL. We wire:

```ts
const editor = useCreateBlockNote({
  uploadFile: async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await saveImage({
      bytes,
      mime: file.type || guessMimeFromName(file.name),
      vaultRoot, docPath, location: settings.imagesLocation,
    })
    return result.relativePath
  },
  resolveFileUrl: async (stored) => {
    if (/^https?:\/\//i.test(stored)) return stored
    const absolute = resolveAgainstDocDir(docPath, stored)
    return convertFileSrc(absolute)
  },
})
```

`docPath`, `vaultRoot`, `location` are read from the store at the time of paste (not closed over), so changes to settings or document don't stale the closure. Use refs or read `useStore.getState()` inside the callback.

When the file's MIME isn't a supported image, `saveImage` throws; we catch in the wrapper and rethrow as a user-visible toast `"Unsupported image type: <mime>"`, then re-throw so BlockNote doesn't insert a broken block.

### Raw mode (CodeMirror)

`useRawImagePaste(viewRef)` attaches two listeners to the CodeMirror host:

- `paste`: if `e.clipboardData.items` contains any item with `kind === "file"` and MIME starts with `image/`, take the **first** such item, `preventDefault()`, save it, dispatch a CodeMirror transaction inserting `![](relativePath)` at the current cursor selection.
- `drop`: same logic with `e.dataTransfer.files`. `preventDefault()` and skip the default file-as-text behavior.

URL paste (`text/uri-list` or text starting with `https?://` and an image extension) is **not** intercepted in raw mode — the default text paste already does the right thing. We could later detect a URL and auto-wrap in `![]()`, but v1 leaves the user to type the `![]()` brackets.

### Tree visibility

Pasted images appear in the configured location. The existing watcher emits `vault-changed`; the tree refreshes. They are only visible in the tree when "Show Images" is enabled in settings — unchanged behavior.

### Empty editor / no doc open

`BlockEditor` is only mounted with a document, and `useRawImagePaste` is conditional on the editor being mounted. Pasting when no file is open has no editor target — nothing to handle.

### Mixed paste

If the paste payload contains both an image and some text (Slack), BlockNote's `uploadFile` is called for the image; text follows BlockNote's default paste path. Two separate blocks land in the doc. No special handling.

### Multiple images in one paste

BlockNote calls `uploadFile` once per file. In raw mode we explicitly handle only the **first** image to keep the cursor behavior predictable; remaining items are dropped. This is a deliberate v1 simplification — if it bites in practice, we can loop.

## 7. Data flow

### Paste a screenshot in block mode

```
user ⌘V
  → browser paste event on the BlockNote contenteditable
  → BlockNote sees File, calls uploadFile(file)
    → file.arrayBuffer() → Uint8Array
    → resolveImageDir(vault, docPath, settings.imagesLocation) = "/Vault/assets"
    → generateFilename("image/png") = "2026-05-10-143052-a3f1.png"
    → ipc.writeImage("/Vault/assets/2026-05-10-143052-a3f1.png", bytes)
      → Rust: mkdir -p, write temp, rename
    → relativeFromDocDir(docPath, absPath) = "assets/2026-05-10-143052-a3f1.png"
    → return that string
  → BlockNote inserts image block, stored URL = "assets/2026-05-10-143052-a3f1.png"
  → BlockNote re-renders, calls resolveFileUrl("assets/…")
    → convertFileSrc("/Vault/assets/…") → "asset://localhost/%2FVault%2Fassets%2F…"
  → <img src="asset://…"> displays
  → auto-save serializes block → markdown body now contains:
      ![](assets/2026-05-10-143052-a3f1.png)
```

### Drop a file from Finder in block mode

Same as above except the source is `dataTransfer.files[0]` instead of a clipboard item. BlockNote's drop handler funnels it through `uploadFile` identically.

### Paste an image URL

User pastes `https://example.com/foo.png` as text into either editor. No image item on the clipboard, just text. Default text paste runs. In block mode, BlockNote recognizes a URL ending in an image extension and inserts an image block with the remote URL; `resolveFileUrl(url)` returns it unchanged. In raw mode, the text just lands as text — the user wraps it with `![]()` themselves.

### Paste in raw mode

```
user ⌘V on CodeMirror
  → paste handler scans clipboardData.items
  → first image item: blob = item.getAsFile()
  → bytes = new Uint8Array(await blob.arrayBuffer())
  → saveImage(…) returns { relativePath: "assets/…png" }
  → view.dispatch({ changes: { from: selection.from, to: selection.to,
                              insert: `![](assets/…png)` },
                    selection: { anchor: selection.from + len } })
  → e.preventDefault()
```

## 8. Error handling

| Failure | Behavior |
|---|---|
| Unsupported MIME (HEIC, etc.) | Toast: "Unsupported image type: image/heic". No insert. |
| `write_image` fails (permission, full disk) | Toast with the error; nothing inserted. |
| Target file already exists (4-hex collision) | Retry up to 3 times with a fresh filename. After 3, toast: "Couldn't pick a unique filename — try again". |
| No doc open | Listener is unmounted; event has no effect. |
| Settings location is `sibling-assets` and the note has no extension or is at the vault root | Resolve normally — `<docDir>/<docStem>.assets/`. If the stem is empty for some reason, fall back to `<docDir>/.assets/` and log a warning. |
| Paste of an image while in raw mode but no markdown image-link syntax can be inserted (e.g., inside a code fence) | We don't detect fences in v1 — the link is inserted literally. User can edit. |
| URL paste of a non-image URL | BlockNote's default text paste handles it. No change. |
| Pasted file's MIME is empty (`File.type === ""`) | Use the file extension to guess MIME. If still unknown, toast and abort. |

## 9. Testing strategy

### Rust unit (`cargo test`)

- `write_image` writes bytes correctly (round-trip).
- `write_image` creates a missing parent directory.
- `write_image` writes atomically (temp file removed on success).
- `write_image` returns an error when the destination already exists.

### Frontend unit (Vitest)

- `resolveImageDir`:
  - `vault-assets` for vault root + nested note paths.
  - `sibling-assets` for vault root + nested note paths.
  - `same-folder` for vault root + nested note paths.
- `generateFilename`:
  - Returns the expected `YYYY-MM-DD-HHMMSS-<4hex>.<ext>` shape.
  - Stable with injected `now` and `rand`.
  - Unknown MIME → throws / returns null.
- `relativeFromDocDir`:
  - Note at vault root, image in `assets/` → `assets/file.png`.
  - Note in `notes/sub/`, image at `assets/` → `../../assets/file.png`.
  - Both same-folder → `file.png`.
  - Always POSIX separators in output.
- `mimeToExt` table.
- `saveImage` (with `invoke` mocked):
  - Happy path: returns the expected `{absolutePath, relativePath}`.
  - Collision retry: existing-file error twice, success on third try.
  - Unsupported MIME aborts before invoke.

### Frontend integration (jsdom)

- BlockEditor: simulate `uploadFile(new File([bytes], "x.png", { type: "image/png" }))` and assert `invoke("write_image", …)` is called with the bytes and the returned string is a relative path.
- `useRawImagePaste`: synthesize a `paste` ClipboardEvent with a File in `items`, mount on a CodeMirror view, assert the inserted text matches `![](…)` at the cursor.

### E2E (Playwright smoke)

- Skipped for clipboard bitmap (hard to script). Add a single drag-drop smoke if feasible:
  - Drop a fixture PNG onto the editor, then verify the .md on disk contains `![](`. (Optional — defer if Playwright's file drop API is awkward in Tauri.)

Existing test suites (`pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, `pnpm test:e2e`) must continue to pass.

## 10. Open items / future work

- **Asset-protocol scope.** v1 uses `scope: ["**"]` so the editor can render images from any vault path. This is permissive. A future change can update the scope dynamically when the vault root changes (Tauri 2 supports runtime scope mutation via the FS plugin scope APIs).
- **Cleanup of orphaned images.** No detection in v1. A future "Vault → Find unused images" command could scan the vault.
- **HEIC support.** Defer — requires decoding to PNG/JPEG, adds binary size. Toast "unsupported" today.
- **Configurable folder name for `vault-assets`.** Hard-coded to `assets/` in v1. Could be configurable later.
- **Resizing/compressing on paste.** Out of scope.
- **Save remote URL locally.** Right-click action on a remote image block, deferred.

## 11. Acceptance criteria

1. Taking a screenshot (Cmd+Shift+4 on macOS) and pasting into the editor in block mode writes a PNG file into `<vault>/assets/` (with the default setting) and inserts an image block displaying it.
2. The on-disk `.md` file contains `![](assets/<filename>.png)` after auto-save.
3. Dragging an image file from Finder into the editor produces the same outcome.
4. Pasting `https://example.com/x.png` inserts a remote image block with no new file written.
5. The same paste and drop flows work in raw mode and insert literal `![](relative-path)` at the cursor.
6. Switching the "Image storage location" setting changes where future pastes are written without affecting existing references.
7. With "Show Images" off in settings, pasted images don't clutter the tree pane but still render in the editor.
8. `cargo test`, `pnpm test`, and `pnpm test:e2e` all pass.
