# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager: **pnpm** (lockfile is `pnpm-lock.yaml`).

```bash
pnpm install                                                # bootstrap
pnpm tauri dev                                              # run the desktop app (Vite + Rust)
pnpm dev                                                    # frontend-only in a browser (no Tauri APIs)
pnpm tauri build                                            # production bundle

pnpm test                                                   # vitest, runs once
pnpm test:watch                                             # vitest in watch mode
pnpm test -- src/lib/__tests__/imagePaste.test.ts           # single file
pnpm test -- -t "encodeMarkdownUrl"                         # single test by name

cargo test --manifest-path src-tauri/Cargo.toml --lib       # Rust unit tests
cargo test --manifest-path src-tauri/Cargo.toml --lib fs::tests::lists_only_markdown_files  # one test

pnpm test:e2e                                               # Playwright smoke (boots Vite, not Tauri)
```

Releases are cut via the manual `Release` GitHub Actions workflow — see `docs/RELEASING.md`. Do not change `plugins.updater.pubkey` in `tauri.conf.json` without an upgrade plan: every installed copy only trusts updates signed by that exact key.

## Architecture

### Two-process model

- **Frontend** (`src/`) — React 19 + TypeScript + Tailwind v4 + Vite + Zustand. BlockNote for the block editor, CodeMirror for raw markdown (lazy-loaded in `EditorPane`).
- **Backend** (`src-tauri/`) — Tauri 2 + Rust. Filesystem ops, frontmatter parsing, file watching, recent-folders persistence, AI agent subprocess management.

All cross-process calls funnel through **`src/lib/ipc.ts`**. It is the single facade — no other frontend code should call `invoke()` directly. Commands are registered in `src-tauri/src/lib.rs` under `tauri::generate_handler!` and live in `src-tauri/src/commands/{fs,recent,watch,agents,frontmatter}.rs`.

### Feature folders

`src/features/<feature>/` is the unit of organization. Each folder owns its UI components and the hooks that wire it to the store. Composition happens in `src/App.tsx`. Notable features:

- `editor/` — `BlockEditor` (BlockNote) and `RawEditor` (CodeMirror, lazy) share a single `openDoc` in the store; `useEditorMode` handles the YAML round-trip when toggling. `useAutoSave` debounces 500ms.
- `tree/` — file tree + context menu + keyboard shortcuts.
- `properties/` — frontmatter editor; `fields/` has one component per inferred YAML type.
- `palette/` — Cmd+P fuzzy file palette (uses `cmdk`).
- `watcher/` — listens for `vault-changed` events from Rust and refreshes the tree / reloads the open doc when clean.
- `ai/` — chat panel that drives a Claude Code subprocess via the agents adapter.
- `updates/` — Tauri updater UI; checks ~10s after launch, banner in bottom-right.

### Zustand store and persistence

`src/lib/store.ts` is the single store. The `partialize` slice deliberately persists **only** `settings`, `rightPane`, and `aiAgent`. Vault path, tree, and the open document are session-scoped — they reload from disk via `useStartupRestore` (which reads the recent-folders list from Rust and re-opens the most recent one). When you add new persisted state, update both `partialize` and the `merge` function (the latter handles legacy-key migrations — see the `propertiesVisible` / `aiPanelVisible` → `rightPane` migration for the pattern).

### Save loop ↔ external watcher (critical to keep coherent)

The file watcher (`src-tauri/src/commands/watch.rs`) emits `vault-changed` events on a 150ms debounce. The frontend (`useExternalChanges`) refreshes the tree and reloads the open doc *only if it is clean*.

To prevent self-write echo: every IPC write that originates in the app calls `noteSelfWrite(path)` immediately before `ipc.writeFile`. Events arriving within `RECENT_WRITE_WINDOW_MS` (1000ms) for a tracked path are dropped. **Any new write path through the frontend must call `noteSelfWrite` or it will fight the autosave loop.**

### Atomic writes

`src-tauri/src/commands/fs.rs` has two write strategies:

- `write_bytes_atomic_clobber` — used by `write_file` (doc saves). Writes to a temp file, then `persist` (rename) onto the target, overwriting.
- `write_bytes_atomic_no_clobber` — used by `write_image`. `persist_noclobber` atomically refuses to overwrite, closing the TOCTOU race two concurrent pastes would otherwise hit.

Image filename collisions are handled by retrying with `-1`, `-2`, ... suffixes in `saveImage` (`src/lib/imagePaste.ts`), up to `MAX_ATTEMPTS`.

### Image paste pipeline

WKWebView on macOS reports `types: ["Files"]` for clipboard images but leaves `items`/`files` empty, so BlockNote's normal paste plugin can't see the bytes. The workaround in `src/lib/imagePaste.ts`:

1. `readClipboardImageAsPng()` reads native RGBA via `@tauri-apps/plugin-clipboard-manager`, draws it into a canvas, and re-encodes as PNG.
2. `ipc.writeImage` base64-encodes via `FileReader.readAsDataURL` and sends as a string — a raw `Uint8Array` over Tauri's JSON IPC stalls on multi-megabyte pastes.
3. Rust decodes base64, writes atomically no-clobber.

Image URLs in markdown are produced by `encodeMarkdownUrl` — it escapes whitespace, parens, and brackets but leaves path separators intact.

### Agents (AI assistant)

`src-tauri/src/commands/agents/mod.rs` defines an `Agent` trait. Only `ClaudeCodeAgent` is wired today; Codex/OpenCode/Pi/Gemini are stubs returned by `detect_agents` so the UI can show them as unavailable.

Adapter contract: `detect()` finds the binary, `build_command()` returns args+env, `parse_line()` parses one NDJSON line into `AiStreamEvent`s. To add an agent, drop a file in `commands/agents/<name>.rs` and register it in `agent_for()`.

`super::which()` does **aggressive PATH fallback** (Homebrew, mise, asdf, npm-global, `~/.claude/local`, etc.) because the desktop app's inherited PATH on macOS is unreliable. Use this — not `std::env::var("PATH")` — when locating user-installed binaries.

The subprocess child is held behind `Arc<Mutex<Child>>` so the reader thread and `stop_ai_session` can both reach it; the waiter polls `try_wait` so it never blocks the mutex.

### Frontmatter round-trip

Two implementations have to stay in sync:

- Rust: `commands/frontmatter.rs` uses `gray_matter` + `serde_yaml`. The canonical save path.
- TS: `src/lib/yaml.ts` (`combineRaw`) and `useEditorMode.ts` (`parseRaw`) — only used to round-trip between block and raw mode in the editor. The simple-YAML parser handles strings/numbers/booleans/null and one-level arrays; complex YAML is filtered upstream by `inferType.ts`.

If you change one side, change the other and update `inferType.test.ts` / the Rust `round_trip_preserves_content` test.

### Updater

`tauri.conf.json` points the updater at `https://ryanb58.github.io/mdwriter/updates/latest.json`. The bundle version is `YYYY.M.D` (no leading zeros — semver doesn't allow them), stamped into `Cargo.toml`/`tauri.conf.json`/`package.json` by the release workflow. Two releases on the same day produce the same version and the updater won't see the second one — roll the date forward instead.

### E2E test scope

Playwright (`e2e/`) drives `pnpm dev` (browser-only — no Tauri runtime). Anything that requires real `invoke()` calls is silently no-op'd by `useStartupRestore`'s try/catch. The current smoke test only verifies the empty state renders.

### Vite chunking

`vite.config.ts` splits BlockNote + CodeMirror + ProseMirror + Lezer + yjs into an `editor-vendor` chunk. The 2.5MB warning threshold is intentional — that's the floor for both editors. Don't lower it.
