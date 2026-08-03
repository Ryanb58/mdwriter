# Window Lifecycle Recovery Design

**Date:** 2026-08-03
**Status:** Approved for implementation

## Problem

On macOS, mdwriter can remain alive while its only window is effectively impossible to find. The reported installation persisted a `2 x 2` main-window size in `.window-state.json`; the window-state plugin considers any non-zero size valid and restores it on every launch. Two lifecycle choices make that failure harder to escape:

- the configured window starts hidden and relies on frontend animation frames plus a five-second Rust fallback to reveal it;
- the red close button destroys the only window, but the macOS process remains alive and the app does not handle Dock `Reopen` events.

There is also no native **Window** menu, so a user has no discoverable recovery command when ordinary window management fails.

## Goals

- Never accept a main window smaller than a usable minimum.
- Recover windows that no longer overlap a connected display by a meaningful amount.
- Make launch, Dock reopen, and second-instance activation all reveal the same valid main window.
- Follow normal macOS close behavior: flush edits, then hide the main window instead of destroying it.
- Add a native **Window** menu with standard macOS commands and explicit recovery actions.
- Keep the existing persisted window-state behavior for legitimate sizes and positions.

## Design

### One recovery path

A new Rust window-lifecycle module owns main-window recovery. Its `reveal_main_window` operation will:

1. find the existing `main` webview window, or recreate it from the checked-in Tauri window configuration;
2. unminimize it;
3. inspect its logical size and physical overlap with connected monitors;
4. reset it to `800 x 600` and center it when the size is below `480 x 360`;
5. center it when less than a `64 x 64` logical region remains visible on any monitor;
6. show and focus it.

Startup, macOS Dock `Reopen`, and the single-instance callback all call this operation. Recovery errors are logged instead of panicking the app.

The geometry decisions are pure functions with Rust unit tests. Platform window calls remain a thin adapter around those decisions.

### Native Window menu

The application menu gains a submenu with Tauri's reserved `WINDOW_SUBMENU_ID`, allowing macOS to recognize it as the native Window menu and append the standard open-window list. It contains:

- Minimize
- Zoom
- Enter Full Screen
- Center Window
- Reset Window Size & Position
- Bring All to Front

`Center Window` preserves the current size. `Reset Window Size & Position` applies `800 x 600` and centers the window. Both reveal and focus the result. Full-screen moves out of the existing View menu; the debug-only developer-tools item remains under View in debug builds.

### Launch and close behavior

The configured main window starts visible and declares `minWidth: 480` and `minHeight: 360`. This removes the circular dependency where a hidden webview must paint before frontend JavaScript is allowed to show its containing window. The frontend `useShowWindowOnReady` hook and the delayed Rust fallback are removed.

On macOS, a close request still prevents the immediate close and awaits the existing autosave flush, but then hides the window. Other platforms retain the current destroy-after-flush behavior. A failed flush keeps the window open on every platform.

## Failure handling

- If monitor enumeration is unavailable, size validation still runs and the current position is retained.
- If the main window was unexpectedly destroyed, the recovery path rebuilds it from `tauri.conf.json`.
- Window mutation failures are returned with context to the caller and logged.
- The explicit Reset command always works, even when automatic recovery considers the geometry valid.

## Verification

- Rust unit tests cover tiny sizes, valid sizes, off-screen positions, and minimum visible overlap.
- Frontend hook tests cover macOS hide-after-flush, non-macOS destroy-after-flush, and flush failures.
- Configuration tests/checks verify the visible launch and minimum dimensions.
- Full frontend and Rust suites, formatting, type checking, and production builds run before handoff.
