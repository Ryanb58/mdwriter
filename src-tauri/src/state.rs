use notify::RecommendedWatcher;
use notify_debouncer_full::{Debouncer, FileIdMap};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    pub active_vault: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<Debouncer<RecommendedWatcher, FileIdMap>>>,
}
