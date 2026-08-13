//! Window-lifecycle commands: the frontend's half of "open another window" and
//! of focus-instead-of-duplicate (reference behavior S1.1, S1.5).
//!
//! The logic lives in `crate::window_lifecycle`; these are thin, label-scoped
//! wrappers so every `#[tauri::command]` stays under `commands/`.

use std::path::PathBuf;

use tauri::{AppHandle, Runtime, State, WebviewWindow};

use crate::errors::{AppError, Result};
use crate::state::AppState;
use crate::window_lifecycle;

/// Open an additional editor window. Returns the new window's label so a caller
/// can address it (and so tests can assert on the routing).
///
/// `async` on purpose: building a window from a *synchronous* command deadlocks
/// on Windows (WebView2 reentrancy), and tauri runs async commands off the main
/// thread. See `WebviewWindowBuilder`'s "Known issues".
#[tauri::command]
pub async fn open_new_window<R: Runtime>(app: AppHandle<R>) -> Result<String> {
    window_lifecycle::open_new_window(&app)
        .map(|window| window.label().to_string())
        .map_err(|error| AppError::Io(format!("failed to open window: {error}")))
}

/// Label of a *different* window that already has `path` open as its vault.
///
/// Deliberately side-effect free: the vault-switch path uses it to hand focus
/// over (S1.5), while a freshly created window uses it to *skip* restoring a
/// vault that is already open elsewhere — and that second caller must not steal
/// focus from the window the user just opened (S1.2).
#[tauri::command]
pub fn find_vault_window<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, AppState>,
    path: PathBuf,
) -> Option<String> {
    window_lifecycle::other_window_with_vault(state.inner(), window.label(), &path)
}

/// Finish closing *this* window, after the frontend has flushed its pending
/// write (S3.1–S3.4).
///
/// The decision — destroy, or hide because this is the last window on macOS —
/// belongs here rather than in the webview: only the backend can count the live
/// windows, and getting it wrong in the "hide" direction silently keeps a closed
/// window's watcher and vault claim alive for the life of the process.
///
/// `async` for the same reason as `open_new_window`, plus one of its own:
/// releasing the window's state drops its file-watcher debouncer, and that drop
/// must not run on the main thread.
#[tauri::command]
pub async fn close_window<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>) -> Result<()> {
    window_lifecycle::close_window(&app, &window)
        .map_err(|error| AppError::Io(format!("failed to close window: {error}")))
}

/// Bring one window to the front, by label.
#[tauri::command]
pub fn focus_window<R: Runtime>(app: AppHandle<R>, label: String) -> Result<()> {
    window_lifecycle::focus_labelled_window(&app, &label)
        .map_err(|error| AppError::NotFound(format!("could not focus window {label}: {error}")))
}
