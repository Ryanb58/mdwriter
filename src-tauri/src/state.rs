use crate::errors::{AppError, Result};
use notify::RecommendedWatcher;
use notify_debouncer_full::{Debouncer, FileIdMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    pub active_vault: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<Debouncer<RecommendedWatcher, FileIdMap>>>,
}

impl AppState {
    /// Canonicalize `path` and verify it lies within the active vault.
    /// Commands that take a vault/root path from the frontend (search,
    /// chats) call this so a compromised webview can't point them at an
    /// arbitrary directory. `list_tree` is the authority that sets the
    /// scope; everything else only validates against it.
    pub fn ensure_within_active_vault(&self, path: &Path) -> Result<PathBuf> {
        let canon = path
            .canonicalize()
            .map_err(|_| AppError::NotFound(path.display().to_string()))?;
        let guard = self.active_vault.lock().unwrap();
        let root = guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidPath("no active vault".into()))?;
        let root_canon = root
            .canonicalize()
            .map_err(|_| AppError::NotFound(root.display().to_string()))?;
        if canon == root_canon || canon.starts_with(&root_canon) {
            Ok(canon)
        } else {
            Err(AppError::InvalidPath(format!(
                "path outside active vault: {}",
                path.display()
            )))
        }
    }
}
