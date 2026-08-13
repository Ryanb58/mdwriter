use crate::errors::{AppError, Result};
use crate::state::AppState;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, FileIdMap};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{Emitter, Manager, State};

#[derive(Serialize, Clone, Debug)]
pub struct VaultChangeEvent {
    pub paths: Vec<PathBuf>,
}

#[tauri::command]
pub fn start_watcher<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    root: PathBuf,
) -> Result<()> {
    // `root` arrives from the webview like any other path argument, so it gets
    // the same treatment: a window may only watch inside the vault it has open.
    // Without this a second window could subscribe to FS notifications for a
    // directory it has no scope over (existence/activity probing), which is the
    // one path-taking command that used to skip the check.
    let root = state
        .get_or_create(window.label())
        .ensure_within_active_vault(&root)?;
    let app_for_emit = window.app_handle().clone();
    // The window that asked for the watch is the only window that should hear
    // about it: it may be the only one on this vault, and another window's tree
    // must not refresh (or reload its open doc) because of a change under a
    // vault it doesn't have open.
    let label_for_emit = window.label().to_string();
    let root_for_filter = root.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(150),
        None,
        move |result: notify_debouncer_full::DebounceEventResult| {
            let events = match result {
                Ok(events) => events,
                Err(errors) => {
                    log::warn!("watcher debounce error: {errors:?}");
                    return;
                }
            };
            let mut paths: Vec<PathBuf> = Vec::new();
            for DebouncedEvent { event, .. } in events {
                for p in event.paths {
                    if should_ignore(&p, &root_for_filter) { continue; }
                    paths.push(p);
                }
            }
            if !paths.is_empty() {
                log::debug!("vault-changed: {} path(s)", paths.len());
                // Addressed, not broadcast. Tauri still delivers to listeners
                // registered with the `Any` target regardless of the address,
                // so the receiving half matters just as much: the frontend
                // subscribes through `listenForThisWindow` (labelled target),
                // never a bare `listen()`.
                if let Err(e) = app_for_emit.emit_to(
                    label_for_emit.as_str(),
                    "vault-changed",
                    VaultChangeEvent { paths },
                ) {
                    log::error!("failed to emit vault-changed: {e}");
                }
            }
        },
    ).map_err(|e| AppError::Watcher(e.to_string()))?;

    debouncer.watcher().watch(&root, RecursiveMode::Recursive)
        .map_err(|e| AppError::Watcher(e.to_string()))?;

    // Swap only once the new watcher is fully wired — building it first
    // means a failed start can't leave the previous watcher already dropped.
    // The old debouncer (if any) is dropped by the assignment.
    //
    // Note: `active_vault` is NOT written here, only read (to validate `root`
    // above). `list_tree` is the single authority for vault scope; a watcher
    // restart must not be able to redefine which paths the fs commands consider
    // in-bounds.
    store_watcher(state.inner(), window.label(), debouncer);

    log::info!("watching vault: {}", root.display());
    Ok(())
}

/// Install a window's watcher under its own label, replacing only that window's
/// previous watcher. Before this was label-scoped, a second window starting a
/// watch dropped the first window's debouncer and it silently stopped receiving
/// `vault-changed` (reference behavior S3.1).
fn store_watcher(
    state: &AppState,
    label: &str,
    debouncer: Debouncer<RecommendedWatcher, FileIdMap>,
) {
    *state.get_or_create(label).watcher.lock().unwrap() = Some(debouncer);
}

#[tauri::command]
pub fn stop_watcher<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, state: State<'_, AppState>) -> Result<()> {
    let window_state = state.get_or_create(window.label());
    *window_state.watcher.lock().unwrap() = None;
    window_state.set_active_vault(None);
    Ok(())
}

fn should_ignore(path: &Path, root: &Path) -> bool {
    let rel = match path.strip_prefix(root) {
        Ok(r) => r,
        Err(_) => return true,
    };
    for component in rel.components() {
        let s = component.as_os_str().to_string_lossy();
        if s.starts_with('.') { return true; }
        if s == "node_modules" || s == "target" { return true; }
    }
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if name.starts_with('.') && name.ends_with(".tmp") { return true; }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::{tempdir, TempDir};

    #[test]
    fn ignores_dot_dirs_and_temp_files() {
        let root = Path::new("/vault");
        assert!(should_ignore(Path::new("/vault/.git/HEAD"), root));
        assert!(should_ignore(Path::new("/vault/notes/.foo.md.tmp"), root));
        assert!(!should_ignore(Path::new("/vault/notes/a.md"), root));
    }

    /// A real debouncer of the production type watching `dir`, so the drop
    /// semantics under test are the ones that ship.
    fn debouncer_for(dir: &TempDir) -> Debouncer<RecommendedWatcher, FileIdMap> {
        let mut debouncer = new_debouncer(Duration::from_millis(150), None, |_result| {}).unwrap();
        debouncer
            .watcher()
            .watch(dir.path(), RecursiveMode::Recursive)
            .unwrap();
        debouncer
    }

    #[test]
    fn a_second_windows_watcher_does_not_replace_the_firsts() {
        // S3.1 / S1.3: window B starting its own watch used to drop window A's
        // debouncer, because both `start_watcher` calls stored into the single
        // hardcoded "main" window — A then silently stopped receiving
        // `vault-changed` for a vault it still had open.
        let vault_a = tempdir().unwrap();
        let vault_b = tempdir().unwrap();
        let state = AppState::default();

        store_watcher(&state, "a", debouncer_for(&vault_a));
        store_watcher(&state, "b", debouncer_for(&vault_b));

        assert!(state.get("a").unwrap().watcher.lock().unwrap().is_some());
        assert!(state.get("b").unwrap().watcher.lock().unwrap().is_some());
        assert_eq!(state.labels(), vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn restarting_one_windows_watcher_leaves_the_other_watching() {
        let vault_a = tempdir().unwrap();
        let vault_b = tempdir().unwrap();
        let state = AppState::default();
        store_watcher(&state, "a", debouncer_for(&vault_a));
        store_watcher(&state, "b", debouncer_for(&vault_b));

        // A re-opens a vault (watcher restart) — B's watcher is untouched.
        store_watcher(&state, "a", debouncer_for(&vault_a));

        assert!(state.get("a").unwrap().watcher.lock().unwrap().is_some());
        assert!(state.get("b").unwrap().watcher.lock().unwrap().is_some());
    }
}
