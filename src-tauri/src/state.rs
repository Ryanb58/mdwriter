use crate::errors::{AppError, Result};
use notify::RecommendedWatcher;
use notify_debouncer_full::{Debouncer, FileIdMap};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

/// Everything that is scoped to one editor window: which vault it has open and
/// the filesystem watcher feeding that vault's `vault-changed` events.
///
/// Dropping a `WindowState` drops its `Debouncer`, which is what releases the
/// platform watch subscription (FSEvents on macOS). That is the whole reason
/// `AppState::remove` hands the state back to the caller instead of discarding
/// it internally: the caller decides when the drop happens.
#[derive(Default)]
pub struct WindowState {
    pub active_vault: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<Debouncer<RecommendedWatcher, FileIdMap>>>,
}

impl WindowState {
    /// Record the vault this window has open. Callers pass an already
    /// canonicalized path (`list_tree` canonicalizes before claiming scope).
    pub fn set_active_vault(&self, path: Option<PathBuf>) {
        *self.active_vault.lock().unwrap() = path;
    }

    /// The vault root for this window, or an error when it has none open.
    pub fn active_vault_root(&self) -> Result<PathBuf> {
        self.active_vault
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| AppError::InvalidPath("no active vault".into()))
    }

    /// Canonicalize `path` and verify it lies within *this window's* active
    /// vault. Commands that take a vault/root path from the frontend (search,
    /// chats) call this so a compromised webview can't point them at an
    /// arbitrary directory — including at another window's vault. `list_tree`
    /// is the authority that sets the scope; everything else only validates
    /// against it.
    pub fn ensure_within_active_vault(&self, path: &Path) -> Result<PathBuf> {
        let canon = path
            .canonicalize()
            .map_err(|_| AppError::NotFound(path.display().to_string()))?;
        let root = self.active_vault_root()?;
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

    /// True when this window's vault is `path` (compared canonically, so
    /// `/var/...` and `/private/var/...` are the same vault).
    ///
    /// The stored root is cloned out and the mutex released *before*
    /// `canonicalize()` — that syscall can block indefinitely on a stalled
    /// network mount, and holding this window's lock (let alone the map lock
    /// `find_by_vault` used to keep) across it would freeze every window's
    /// commands with it.
    fn has_vault(&self, canonical_query: &Path, raw_query: &Path) -> bool {
        let stored = self.active_vault.lock().unwrap().clone();
        let Some(vault) = stored else {
            return false;
        };
        if vault == raw_query || vault == canonical_query {
            return true;
        }
        // The stored root may no longer exist (vault deleted or unmounted);
        // in that case the raw comparisons above are all we have.
        match vault.canonicalize() {
            Ok(vault_canon) => vault_canon == canonical_query,
            Err(_) => false,
        }
    }
}

/// The window map plus the set of labels whose window is gone for good.
#[derive(Default)]
struct Windows {
    live: HashMap<String, Arc<WindowState>>,
    /// Labels retired by `remove`. A destroyed window can still have IPC calls
    /// in flight, and those calls must not be able to re-insert state — a late
    /// `start_watcher` would install a `Debouncer` under a label that will
    /// never see another destroy event, leaking the watch subscription for the
    /// life of the process. `register` (the window-created path) is the only
    /// way back in, so a *new* window that reuses a label still works.
    closed: HashSet<String>,
}

/// Process-wide state: one `WindowState` per Tauri window label.
///
/// Held in a `RwLock` because lookups (every IPC command) vastly outnumber
/// inserts and removals (window open/close). Values are `Arc` so a command can
/// clone its window's state out and release the map lock before doing
/// filesystem work — and so `remove` can return a live handle whose drop tears
/// the watcher down.
///
/// Lock discipline: the map lock is always taken *before* a `WindowState` mutex
/// and never the other way around, and no `Arc<WindowState>` is ever dropped
/// while the map lock is held (dropping one joins the debouncer's thread).
#[derive(Default)]
pub struct AppState {
    windows: RwLock<Windows>,
}

impl AppState {
    /// State for the window a command arrived from, creating an empty one on
    /// first use.
    ///
    /// If `label` has already been retired by `remove`, this returns a detached
    /// state that is *not* in the map: the late command sees an empty window
    /// (so it fails with "no active vault" instead of touching another window's
    /// vault) and anything it stores there — including a watcher — is dropped
    /// with the command.
    pub fn get_or_create(&self, label: &str) -> Arc<WindowState> {
        if let Some(existing) = self.get(label) {
            return existing;
        }
        let mut windows = self.windows.write().unwrap();
        if windows.closed.contains(label) {
            return Arc::new(WindowState::default());
        }
        // Another thread may have inserted while the read lock was released.
        Arc::clone(
            windows
                .live
                .entry(label.to_string())
                .or_insert_with(|| Arc::new(WindowState::default())),
        )
    }

    /// Announce a window that has just been created, clearing any tombstone
    /// left by an earlier window with the same label. Existing state for a live
    /// label is preserved — this is called on every reveal, not just the first.
    pub fn register(&self, label: &str) -> Arc<WindowState> {
        let mut windows = self.windows.write().unwrap();
        windows.closed.remove(label);
        Arc::clone(
            windows
                .live
                .entry(label.to_string())
                .or_insert_with(|| Arc::new(WindowState::default())),
        )
    }

    /// State for `label` if the window is known, without creating it.
    pub fn get(&self, label: &str) -> Option<Arc<WindowState>> {
        self.windows.read().unwrap().live.get(label).map(Arc::clone)
    }

    /// Retire `label` and hand its state back. Dropping the returned value runs
    /// `Debouncer`'s `Drop`, releasing that window's watch subscriptions. If the
    /// caller ignores the return value it is dropped immediately, which is the
    /// desired teardown — the value is returned so callers that need to observe
    /// or delay teardown can.
    ///
    /// The removal is final: only `register` can bring the label back.
    ///
    /// Called from the `WindowEvent::Destroyed` handler
    /// (`window_lifecycle::on_window_destroyed`).
    #[must_use = "dropping the returned state is what releases the window's watcher"]
    pub fn remove(&self, label: &str) -> Option<Arc<WindowState>> {
        let mut windows = self.windows.write().unwrap();
        windows.closed.insert(label.to_string());
        let removed = windows.live.remove(label);
        // Release the map lock before the caller (or this function's own return)
        // can drop the Arc: dropping a WindowState joins its debouncer thread,
        // which must never happen under the map lock.
        drop(windows);
        removed
    }

    /// Label of the window that already has `path` open, for
    /// focus-instead-of-duplicate. Matches canonically, so a path that resolves
    /// through symlinks (`/var` → `/private/var` on macOS) finds the window
    /// that stored the resolved form.
    ///
    /// The unfiltered form. Production always goes through
    /// `find_by_vault_excluding` (the asking window is never its own duplicate),
    /// so this is exercised by tests only — it stays as the plain primitive both
    /// the exclusion logic and its tests are stated against.
    #[allow(dead_code)]
    pub fn find_by_vault(&self, path: &Path) -> Option<String> {
        self.find_vault_label(path, None)
    }

    /// As `find_by_vault`, ignoring one label — the window that is *asking*.
    /// A window re-opening the vault it already has must not be told to go
    /// focus itself; it should just reload.
    pub fn find_by_vault_excluding(&self, path: &Path, exclude: &str) -> Option<String> {
        self.find_vault_label(path, Some(exclude))
    }

    fn find_vault_label(&self, path: &Path, exclude: Option<&str>) -> Option<String> {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        // Snapshot under the lock, compare outside it: `has_vault` may
        // canonicalize the stored root, and that syscall must not be able to
        // block window open/close.
        let mut entries: Vec<(String, Arc<WindowState>)> = {
            let windows = self.windows.read().unwrap();
            windows
                .live
                .iter()
                .filter(|(label, _)| Some(label.as_str()) != exclude)
                .map(|(label, state)| (label.clone(), Arc::clone(state)))
                .collect()
        };
        // Compare in label order so the answer is stable if two windows ever
        // do end up on the same vault.
        entries.sort_by(|left, right| left.0.cmp(&right.0));
        entries
            .into_iter()
            .find(|(_, state)| state.has_vault(&canonical, path))
            .map(|(label, _)| label)
    }

    /// Every live window label, sorted.
    #[allow(dead_code)]
    pub fn labels(&self) -> Vec<String> {
        let mut labels: Vec<String> = self.windows.read().unwrap().live.keys().cloned().collect();
        labels.sort();
        labels
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::{RecursiveMode, Watcher};
    use notify_debouncer_full::new_debouncer;
    use std::sync::Weak;
    use std::time::Duration;
    use tempfile::{tempdir, TempDir};

    /// A real watcher of the exact production type, so drop behavior under test
    /// is the drop behavior that ships.
    fn watch(dir: &TempDir) -> Debouncer<RecommendedWatcher, FileIdMap> {
        let mut debouncer = new_debouncer(Duration::from_millis(150), None, |_result| {}).unwrap();
        debouncer
            .watcher()
            .watch(dir.path(), RecursiveMode::Recursive)
            .unwrap();
        debouncer
    }

    #[test]
    fn get_or_create_is_stable_per_label_and_distinct_across_labels() {
        let app = AppState::default();

        let a1 = app.get_or_create("a");
        let a2 = app.get_or_create("a");
        let b = app.get_or_create("b");

        assert!(Arc::ptr_eq(&a1, &a2));
        assert!(!Arc::ptr_eq(&a1, &b));
        assert_eq!(app.labels(), vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn get_does_not_create_unknown_windows() {
        let app = AppState::default();

        assert!(app.get("ghost").is_none());
        assert!(app.labels().is_empty());
    }

    #[test]
    fn two_labels_hold_independent_vaults() {
        let vault_a = tempdir().unwrap();
        let vault_b = tempdir().unwrap();
        let app = AppState::default();

        app.get_or_create("a")
            .set_active_vault(Some(vault_a.path().canonicalize().unwrap()));
        app.get_or_create("b")
            .set_active_vault(Some(vault_b.path().canonicalize().unwrap()));

        assert_eq!(
            app.get("a").unwrap().active_vault_root().unwrap(),
            vault_a.path().canonicalize().unwrap()
        );
        assert_eq!(
            app.get("b").unwrap().active_vault_root().unwrap(),
            vault_b.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn clearing_one_windows_vault_leaves_the_other_open() {
        let vault_a = tempdir().unwrap();
        let vault_b = tempdir().unwrap();
        let app = AppState::default();
        app.get_or_create("a")
            .set_active_vault(Some(vault_a.path().canonicalize().unwrap()));
        app.get_or_create("b")
            .set_active_vault(Some(vault_b.path().canonicalize().unwrap()));

        app.get("a").unwrap().set_active_vault(None);

        assert!(app.get("a").unwrap().active_vault_root().is_err());
        assert_eq!(
            app.get("b").unwrap().active_vault_root().unwrap(),
            vault_b.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn two_labels_hold_independent_watchers() {
        let vault_a = tempdir().unwrap();
        let vault_b = tempdir().unwrap();
        let app = AppState::default();

        *app.get_or_create("a").watcher.lock().unwrap() = Some(watch(&vault_a));
        *app.get_or_create("b").watcher.lock().unwrap() = Some(watch(&vault_b));

        *app.get("a").unwrap().watcher.lock().unwrap() = None;

        assert!(app.get("a").unwrap().watcher.lock().unwrap().is_none());
        assert!(app.get("b").unwrap().watcher.lock().unwrap().is_some());
    }

    #[test]
    fn removing_a_window_leaves_the_other_intact() {
        let vault_a = tempdir().unwrap();
        let vault_b = tempdir().unwrap();
        let app = AppState::default();
        let a = app.get_or_create("a");
        a.set_active_vault(Some(vault_a.path().canonicalize().unwrap()));
        *a.watcher.lock().unwrap() = Some(watch(&vault_a));
        let b = app.get_or_create("b");
        b.set_active_vault(Some(vault_b.path().canonicalize().unwrap()));
        *b.watcher.lock().unwrap() = Some(watch(&vault_b));
        drop(a);

        let removed = app.remove("a").expect("window a was registered");

        assert!(app.get("a").is_none());
        assert_eq!(app.labels(), vec!["b".to_string()]);
        // The removed state still carries the watcher, so dropping it — not the
        // map removal — is what tears the subscription down.
        assert!(removed.watcher.lock().unwrap().is_some());
        drop(removed);
        assert_eq!(
            app.get("b").unwrap().active_vault_root().unwrap(),
            vault_b.path().canonicalize().unwrap()
        );
        assert!(app.get("b").unwrap().watcher.lock().unwrap().is_some());
    }

    #[test]
    fn removing_a_window_drops_its_watcher() {
        let vault = tempdir().unwrap();
        let app = AppState::default();
        let observer: Weak<WindowState> = {
            let state = app.get_or_create("a");
            *state.watcher.lock().unwrap() = Some(watch(&vault));
            Arc::downgrade(&state)
        };

        let removed = app.remove("a").expect("window a was registered");
        // Sole strong reference: dropping it destroys the WindowState, and with
        // it the Debouncer, which is what releases the FSEvents subscription.
        assert_eq!(Arc::strong_count(&removed), 1);
        drop(removed);

        assert!(
            observer.upgrade().is_none(),
            "window state (and its watcher) outlived removal"
        );
    }

    #[test]
    fn removing_an_unknown_window_is_a_no_op() {
        let app = AppState::default();
        app.get_or_create("a");

        assert!(app.remove("ghost").is_none());
        assert_eq!(app.labels(), vec!["a".to_string()]);
    }

    #[test]
    fn find_by_vault_matches_canonicalized_paths() {
        // On macOS a tempdir lives under /var/folders, a symlink to
        // /private/var/folders. `list_tree` stores the canonical form, and the
        // frontend may hand back either.
        let vault = tempdir().unwrap();
        let canonical = vault.path().canonicalize().unwrap();
        let app = AppState::default();
        app.get_or_create("a")
            .set_active_vault(Some(canonical.clone()));

        assert_eq!(app.find_by_vault(&canonical), Some("a".to_string()));
        assert_eq!(app.find_by_vault(vault.path()), Some("a".to_string()));
        assert_eq!(
            app.find_by_vault(&vault.path().join(".")),
            Some("a".to_string())
        );
    }

    #[test]
    fn find_by_vault_matches_a_non_canonical_stored_root() {
        let vault = tempdir().unwrap();
        let app = AppState::default();
        // Defensive: a caller that stored the unresolved /var form must still
        // be found when asked with the resolved /private/var form.
        app.get_or_create("a")
            .set_active_vault(Some(vault.path().to_path_buf()));

        assert_eq!(
            app.find_by_vault(&vault.path().canonicalize().unwrap()),
            Some("a".to_string())
        );
    }

    #[test]
    fn find_by_vault_picks_the_window_holding_that_vault() {
        let vault_a = tempdir().unwrap();
        let vault_b = tempdir().unwrap();
        let app = AppState::default();
        app.get_or_create("a")
            .set_active_vault(Some(vault_a.path().canonicalize().unwrap()));
        app.get_or_create("b")
            .set_active_vault(Some(vault_b.path().canonicalize().unwrap()));

        assert_eq!(app.find_by_vault(vault_a.path()), Some("a".to_string()));
        assert_eq!(app.find_by_vault(vault_b.path()), Some("b".to_string()));
    }

    #[test]
    fn find_by_vault_returns_none_for_unopened_and_vaultless_windows() {
        let opened = tempdir().unwrap();
        let other = tempdir().unwrap();
        let app = AppState::default();
        app.get_or_create("empty");
        app.get_or_create("a")
            .set_active_vault(Some(opened.path().canonicalize().unwrap()));

        assert_eq!(app.find_by_vault(other.path()), None);
        // A subdirectory of an open vault is not that vault.
        let nested = opened.path().join("nested");
        std::fs::create_dir(&nested).unwrap();
        assert_eq!(app.find_by_vault(&nested), None);
    }

    #[test]
    fn find_by_vault_excluding_skips_only_the_named_window() {
        let vault = tempdir().unwrap();
        let app = AppState::default();
        app.get_or_create("a")
            .set_active_vault(Some(vault.path().canonicalize().unwrap()));

        // Excluding the holder hides it (the asking window is not its own
        // duplicate); excluding anyone else leaves it findable.
        assert_eq!(app.find_by_vault_excluding(vault.path(), "a"), None);
        assert_eq!(
            app.find_by_vault_excluding(vault.path(), "b"),
            Some("a".to_string())
        );
        assert_eq!(
            app.find_by_vault_excluding(vault.path(), ""),
            Some("a".to_string())
        );
    }

    #[test]
    fn find_by_vault_ignores_a_removed_window() {
        let vault = tempdir().unwrap();
        let app = AppState::default();
        app.get_or_create("a")
            .set_active_vault(Some(vault.path().canonicalize().unwrap()));

        drop(app.remove("a"));

        assert_eq!(app.find_by_vault(vault.path()), None);
    }

    #[test]
    fn ensure_within_active_vault_accepts_the_windows_own_vault() {
        let vault = tempdir().unwrap();
        let file = vault.path().join("note.md");
        std::fs::write(&file, "hi").unwrap();
        let app = AppState::default();
        app.get_or_create("a")
            .set_active_vault(Some(vault.path().canonicalize().unwrap()));

        let state = app.get("a").unwrap();
        assert_eq!(
            state.ensure_within_active_vault(&file).unwrap(),
            file.canonicalize().unwrap()
        );
        assert_eq!(
            state.ensure_within_active_vault(vault.path()).unwrap(),
            vault.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn ensure_within_active_vault_rejects_another_windows_vault() {
        let vault_a = tempdir().unwrap();
        let vault_b = tempdir().unwrap();
        let in_a = vault_a.path().join("a.md");
        std::fs::write(&in_a, "a").unwrap();
        let app = AppState::default();
        app.get_or_create("a")
            .set_active_vault(Some(vault_a.path().canonicalize().unwrap()));
        app.get_or_create("b")
            .set_active_vault(Some(vault_b.path().canonicalize().unwrap()));

        // Window A can reach its own file; window B must not, even though the
        // path is a perfectly valid vault path *for A*.
        assert!(app
            .get("a")
            .unwrap()
            .ensure_within_active_vault(&in_a)
            .is_ok());
        assert!(matches!(
            app.get("b").unwrap().ensure_within_active_vault(&in_a),
            Err(AppError::InvalidPath(_))
        ));
        assert!(matches!(
            app.get("b")
                .unwrap()
                .ensure_within_active_vault(vault_a.path()),
            Err(AppError::InvalidPath(_))
        ));
    }

    #[test]
    fn ensure_within_active_vault_errors_when_the_window_has_no_vault() {
        let dir = tempdir().unwrap();
        let app = AppState::default();

        assert!(matches!(
            app.get_or_create("a")
                .ensure_within_active_vault(dir.path()),
            Err(AppError::InvalidPath(_))
        ));
    }

    #[test]
    fn ensure_within_active_vault_reports_missing_paths_as_not_found() {
        let vault = tempdir().unwrap();
        let app = AppState::default();
        app.get_or_create("a")
            .set_active_vault(Some(vault.path().canonicalize().unwrap()));

        assert!(matches!(
            app.get("a")
                .unwrap()
                .ensure_within_active_vault(&vault.path().join("missing.md")),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn a_late_command_cannot_resurrect_a_removed_window() {
        let vault = tempdir().unwrap();
        let app = AppState::default();
        app.get_or_create("a")
            .set_active_vault(Some(vault.path().canonicalize().unwrap()));

        drop(app.remove("a"));
        // An IPC call from the destroyed window arriving after teardown.
        let late = app.get_or_create("a");

        // It gets detached, empty state: not in the map, no vault, so the
        // command fails cleanly instead of operating on a stale scope.
        assert!(app.labels().is_empty());
        assert!(app.get("a").is_none());
        assert!(late.active_vault_root().is_err());
    }

    #[test]
    fn a_watcher_installed_by_a_late_command_is_not_leaked() {
        let vault = tempdir().unwrap();
        let app = AppState::default();
        app.get_or_create("a");
        drop(app.remove("a"));

        // What a late `start_watcher` does: resolve the label, store a real
        // debouncer. Because the state is detached, the watcher dies with the
        // command instead of living in the map with no window left to drop it.
        let observer = {
            let late = app.get_or_create("a");
            *late.watcher.lock().unwrap() = Some(watch(&vault));
            Arc::downgrade(&late)
        };

        assert!(observer.upgrade().is_none(), "late watcher outlived the call");
        assert!(app.labels().is_empty());
    }

    #[test]
    fn register_revives_a_label_reused_by_a_new_window() {
        let vault = tempdir().unwrap();
        let app = AppState::default();
        app.get_or_create("main")
            .set_active_vault(Some(vault.path().canonicalize().unwrap()));
        drop(app.remove("main"));

        // A brand new window with the same label (macOS: closed, then reopened
        // from the Dock) is announced through `register`, which is the only way
        // past the tombstone.
        let revived = app.register("main");
        revived.set_active_vault(Some(vault.path().canonicalize().unwrap()));

        assert_eq!(app.labels(), vec!["main".to_string()]);
        assert!(Arc::ptr_eq(&revived, &app.get_or_create("main")));
        assert_eq!(
            app.find_by_vault(vault.path()),
            Some("main".to_string())
        );
    }

    #[test]
    fn register_keeps_the_state_of_a_window_that_is_already_live() {
        let vault = tempdir().unwrap();
        let app = AppState::default();
        let first = app.get_or_create("main");
        first.set_active_vault(Some(vault.path().canonicalize().unwrap()));

        // `reveal_main_window` registers on every reveal, not just creation.
        let again = app.register("main");

        assert!(Arc::ptr_eq(&first, &again));
        assert_eq!(
            again.active_vault_root().unwrap(),
            vault.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn concurrent_label_traffic_never_splits_a_windows_state() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Barrier;

        let app = Arc::new(AppState::default());
        let barrier = Arc::new(Barrier::new(8));
        let splits = Arc::new(AtomicUsize::new(0));

        // Race the double-checked insert in `get_or_create`: every thread must
        // end up with the *same* Arc per label, or two windows would each have
        // half of one window's vault/watcher.
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let app = Arc::clone(&app);
                let barrier = Arc::clone(&barrier);
                let splits = Arc::clone(&splits);
                std::thread::spawn(move || {
                    barrier.wait();
                    for n in 0..200 {
                        let label = format!("w{}", n % 4);
                        let mine = app.get_or_create(&label);
                        let theirs = app.get(&label).expect("just created");
                        if !Arc::ptr_eq(&mine, &theirs) {
                            splits.fetch_add(1, Ordering::Relaxed);
                        }
                        if i == 0 {
                            let _ = app.labels();
                        }
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(splits.load(Ordering::Relaxed), 0);
        assert_eq!(
            app.labels(),
            vec![
                "w0".to_string(),
                "w1".to_string(),
                "w2".to_string(),
                "w3".to_string()
            ]
        );
    }
}
