use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    pub active_vault: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<Box<dyn Send + Sync>>>,
}
