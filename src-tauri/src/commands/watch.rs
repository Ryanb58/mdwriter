use crate::errors::{AppError, Result};
use crate::state::AppState;
use notify::{RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebouncedEvent};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{Emitter, Manager};

#[derive(Serialize, Clone, Debug)]
pub struct VaultChangeEvent {
    pub paths: Vec<PathBuf>,
}

#[tauri::command]
pub fn start_watcher(app: tauri::AppHandle, root: PathBuf) -> Result<()> {
    let state = app.state::<AppState>();
    let mut watcher_lock = state.watcher.lock().unwrap();
    *watcher_lock = None; // drop any existing watcher first

    let app_for_emit = app.clone();
    let root_for_filter = root.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(150),
        None,
        move |result: notify_debouncer_full::DebounceEventResult| {
            let Ok(events) = result else { return };
            let mut paths: Vec<PathBuf> = Vec::new();
            for DebouncedEvent { event, .. } in events {
                for p in event.paths {
                    if should_ignore(&p, &root_for_filter) { continue; }
                    paths.push(p);
                }
            }
            if !paths.is_empty() {
                let _ = app_for_emit.emit("vault-changed", VaultChangeEvent { paths });
            }
        },
    ).map_err(|e| AppError::Watcher(e.to_string()))?;

    debouncer.watcher().watch(&root, RecursiveMode::Recursive)
        .map_err(|e| AppError::Watcher(e.to_string()))?;
    *watcher_lock = Some(debouncer);

    let mut active = state.active_vault.lock().unwrap();
    *active = Some(root);
    Ok(())
}

#[tauri::command]
pub fn stop_watcher(app: tauri::AppHandle) -> Result<()> {
    let state = app.state::<AppState>();
    *state.watcher.lock().unwrap() = None;
    *state.active_vault.lock().unwrap() = None;
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
    use super::should_ignore;
    use std::path::Path;

    #[test]
    fn ignores_dot_dirs_and_temp_files() {
        let root = Path::new("/vault");
        assert!(should_ignore(Path::new("/vault/.git/HEAD"), root));
        assert!(should_ignore(Path::new("/vault/notes/.foo.md.tmp"), root));
        assert!(!should_ignore(Path::new("/vault/notes/a.md"), root));
    }
}
