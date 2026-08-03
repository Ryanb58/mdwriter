# Window Lifecycle Recovery Implementation Plan

> Implement this plan test-first on branch `fix/window-lifecycle-recovery` in the isolated worktree `/private/tmp/mdwriter-window-lifecycle`.

**Goal:** Make the mdwriter window reliably recoverable on macOS and add a native Window menu with explicit recovery commands.

**Architecture:** Put geometry policy and native-window operations in a small Rust `window_lifecycle` module. Route startup, Dock reopen, single-instance activation, and Window-menu commands through that module. Keep close-time document flushing in the existing React hook, but hide rather than destroy on macOS.

**Stack:** Tauri 2 / Rust, React 19 / TypeScript, Vitest.

---

## Task 1: Specify geometry recovery with failing Rust tests

**Files:**

- Create: `src-tauri/src/window_lifecycle.rs`
- Modify: `src-tauri/src/lib.rs`

Add tests for these policy boundaries before implementation:

- `2 x 2` logical pixels is unusable;
- `480 x 360` is the minimum valid size;
- a window wholly outside every monitor needs centering;
- at least `64 x 64` logical pixels visible on one monitor is sufficient;
- menu identifiers map only to Center and Reset recovery commands.

Run `cargo test --manifest-path src-tauri/Cargo.toml --lib window_lifecycle::tests` and confirm the new tests fail for the expected missing behavior.

Then implement the pure rectangle, size, and menu-command functions and rerun the focused test until green.

## Task 2: Implement the shared native recovery path

**Files:**

- Modify: `src-tauri/src/window_lifecycle.rs`
- Modify: `src-tauri/src/lib.rs`

Implement these operations:

- locate or recreate the configured `main` webview window;
- recover an unusably small window to `800 x 600` and center it;
- center an off-screen window without changing its valid size;
- unminimize, show, and focus;
- expose explicit center and reset operations for menu events.

Replace the ad-hoc single-instance show/focus code with the shared recovery function. Call it once during setup after the window-state plugin has restored persisted geometry. Handle macOS `RunEvent::Reopen` using the same path.

Run the focused Rust tests, then `cargo test --manifest-path src-tauri/Cargo.toml --lib`.

## Task 3: Add the native Window menu

**Files:**

- Modify: `src-tauri/src/lib.rs`

Build a submenu with `tauri::menu::WINDOW_SUBMENU_ID` and add native Minimize, Zoom, Full Screen, and Bring All to Front items. Add custom Center Window and Reset Window Size & Position items and dispatch them through the tested command mapping.

Move Full Screen out of View. Keep View only for the debug developer-tools item and omit it in release builds.

Compile the Rust target and rerun its test suite.

## Task 4: Remove the hidden-launch dependency

**Files:**

- Modify: `src-tauri/tauri.conf.json`
- Modify: `src/App.tsx`
- Delete: `src/lib/useShowWindowOnReady.ts`

Set the main window to visible at creation and add `minWidth: 480` / `minHeight: 360`. Remove the frontend reveal hook and the Rust five-second fallback.

Add a source-level or parsed-configuration regression test if the existing test structure supports it without coupling tests to implementation text.

Run frontend type checking and the Rust suite.

## Task 5: Preserve the macOS window on close

**Files:**

- Modify: `src/layout/useIsMacTauri.ts`
- Modify: `src/features/editor/useAutoSave.ts`
- Modify: `src/features/editor/__tests__/useAutoSave.test.tsx`
- Modify: `src-tauri/capabilities/default.json`

First change the hook tests to require:

- macOS: prevent close, await flush, then hide;
- non-macOS: prevent close, await flush, then destroy;
- failed flush: do neither.

Confirm the focused test fails, then export a reusable platform detector, add the window hide permission, and implement the platform-specific completion action. Rerun the focused test until green.

## Task 6: Verify and review

Run:

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `./node_modules/.bin/vitest run`
- `./node_modules/.bin/tsc -b`
- `./node_modules/.bin/vite build`
- `cargo check --manifest-path src-tauri/Cargo.toml`

Review `git diff --check`, inspect the final diff for lifecycle regressions and unrelated changes, then commit the implementation on the clean feature branch. Do not merge or push without an explicit request.
