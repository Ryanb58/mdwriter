//! End-to-end IPC isolation tests for two windows on two vaults.
//!
//! The per-command unit tests elsewhere drive the `*_scoped(state, label, …)`
//! seams directly, which proves the scoping logic but *assumes* the label is
//! the calling window's. These tests remove that assumption: they build a real
//! (mock-runtime) Tauri app with two labelled webviews, push messages through
//! the actual `#[tauri::command]` dispatch path with `get_ipc_response`, and
//! assert on what comes back. If a command ever stops taking its label from the
//! calling window, these fail while the seam tests keep passing.
//!
//! Reference behavior S1.3: "Each window has fully independent state: file
//! tree, open editor, search index, watcher."

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde_json::json;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Emitter, Listener, Manager, WebviewWindow, WebviewWindowBuilder};
use tempfile::{tempdir, TempDir};

use crate::commands;
use crate::commands::agents::AgentSession;
use crate::state::AppState;

/// The default mock app deliberately does **not** manage an `AgentSession`.
/// Every `start_ai_session` assertion against it is about the vault-scope check,
/// which runs before the session state is touched; a test that gets past it
/// fails loudly on the missing state instead of quietly spawning a real agent
/// subprocess on the machine running the suite. Tests that *mean* to get past it
/// use [`session_test_app`] and a stub agent.
fn test_app() -> App<MockRuntime> {
    build_app(false)
}

/// Mock app *with* the process-global `AgentSession`, for the single-owner-lock
/// and session-ownership tests. Those exercise the label checks, which all sit
/// in front of the adapter lookup — no test here may name an implemented agent
/// with a real binary, or it would spawn one.
fn session_test_app() -> App<MockRuntime> {
    build_app(true)
}

fn build_app(with_agent_session: bool) -> App<MockRuntime> {
    let builder = mock_builder()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::fs::list_tree,
            commands::fs::list_directory,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::create_file,
            commands::fs::trash_path,
            commands::notes::list_markdown_notes,
            commands::search::search_vault,
            commands::chats::write_chat,
            commands::skills::list_skills,
            commands::watch::start_watcher,
            commands::watch::stop_watcher,
            commands::agents::start_ai_session,
            commands::agents::stop_ai_session,
            commands::agents::respond_permission,
            commands::agents::add_permission_rule,
            commands::windows::open_new_window,
            commands::windows::find_vault_window,
            commands::windows::close_window,
            commands::windows::focus_window,
        ]);
    let builder = if with_agent_session {
        builder.manage(AgentSession::default())
    } else {
        builder
    };
    builder
        .build(mock_context(noop_assets()))
        .expect("mock app builds")
}

fn window(app: &App<MockRuntime>, label: &str) -> WebviewWindow<MockRuntime> {
    WebviewWindowBuilder::new(app, label, Default::default())
        .build()
        .expect("mock webview builds")
}

/// Push one IPC message through the real command dispatcher as `webview`.
fn invoke(
    webview: &WebviewWindow<MockRuntime>,
    cmd: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let response = tauri::test::get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            // The webview's own protocol URL. A non-local origin would be
            // refused by the ACL before the command ever runs.
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    );
    match response {
        Ok(body) => Ok(body.deserialize().expect("command result deserializes")),
        Err(error) => Err(error.to_string()),
    }
}

/// A vault with one note in it, plus the note's path as the frontend would send
/// it (a plain absolute path string).
fn vault_with_note(name: &str, body: &str) -> (TempDir, String, String) {
    let dir = tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let note = root.join(name);
    std::fs::write(&note, body).unwrap();
    let root_str = root.to_string_lossy().into_owned();
    let note_str = note.to_string_lossy().into_owned();
    (dir, root_str, note_str)
}

/// `read_file` returns `{ text, digest }` (the digest being the save
/// precondition, S2.3). Most assertions here only care about the text.
fn read_text(webview: &WebviewWindow<MockRuntime>, path: &str) -> Result<String, String> {
    let value = invoke(webview, "read_file", json!({ "path": path }))?;
    Ok(value["text"]
        .as_str()
        .expect("read_file returns text")
        .to_string())
}

/// Open `root` in `webview`, which is what establishes that window's vault
/// scope (`list_tree` is the single authority).
fn open_vault(webview: &WebviewWindow<MockRuntime>, root: &str) {
    invoke(webview, "list_tree", json!({ "root": root })).expect("vault opens");
}

#[test]
fn each_window_keeps_its_own_vault_scope() {
    let app = test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");

    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);

    let state = app.state::<AppState>();
    assert_eq!(
        state.get("a").unwrap().active_vault_root().unwrap(),
        Path::new(&root_a)
    );
    assert_eq!(
        state.get("b").unwrap().active_vault_root().unwrap(),
        Path::new(&root_b)
    );
}

#[test]
fn a_read_from_one_window_cannot_reach_the_other_windows_vault() {
    let app = test_app();
    let (_a, root_a, note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);

    // Each window reads its own note.
    assert_eq!(read_text(&win_a, &note_a).unwrap(), "in a");
    assert_eq!(read_text(&win_b, &note_b).unwrap(), "in b");
    // Neither can read across, even though the path is a valid vault path for
    // the *other* window.
    assert!(read_text(&win_b, &note_a).is_err());
    assert!(read_text(&win_a, &note_b).is_err());
}

#[test]
fn a_write_from_one_window_cannot_reach_the_other_windows_vault() {
    let app = test_app();
    let (_a, root_a, note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);

    assert!(invoke(
        &win_b,
        "write_file",
        json!({ "path": note_a, "text": "clobbered by b" })
    )
    .is_err());
    assert_eq!(std::fs::read_to_string(&note_a).unwrap(), "in a");

    // A's own write still lands.
    invoke(
        &win_a,
        "write_file",
        json!({ "path": note_a, "text": "written by a" }),
    )
    .unwrap();
    assert_eq!(std::fs::read_to_string(&note_a).unwrap(), "written by a");
}

#[test]
fn a_stale_save_over_real_ipc_is_refused_with_a_save_conflict() {
    // S2.3 end to end: two windows on the *same* vault, both having read the
    // same note. A saves; B's save carries the digest B read, which no longer
    // matches disk, so B is refused rather than clobbering A.
    let app = test_app();
    let (_v, root, note) = vault_with_note("shared.md", "v1");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root);
    open_vault(&win_b, &root);

    let a_snapshot = invoke(&win_a, "read_file", json!({ "path": note })).unwrap();
    let b_snapshot = invoke(&win_b, "read_file", json!({ "path": note })).unwrap();
    let a_digest = a_snapshot["digest"].as_str().unwrap().to_string();
    let b_digest = b_snapshot["digest"].as_str().unwrap().to_string();

    let a_new_digest = invoke(
        &win_a,
        "write_file",
        json!({ "path": note, "text": "A's version", "expectedDigest": a_digest }),
    )
    .expect("A's save is in-precondition");

    let err = invoke(
        &win_b,
        "write_file",
        json!({ "path": note, "text": "B's version", "expectedDigest": b_digest }),
    )
    .expect_err("B's stale save must be refused");
    assert!(err.contains("SaveConflict"), "unexpected error: {err}");
    assert_eq!(std::fs::read_to_string(&note).unwrap(), "A's version");

    // The digest A got back from its own write is what lets A keep saving
    // without tripping over itself.
    invoke(
        &win_a,
        "write_file",
        json!({ "path": note, "text": "A again", "expectedDigest": a_new_digest }),
    )
    .expect("A's follow-up save uses the digest its last save returned");
    assert_eq!(std::fs::read_to_string(&note).unwrap(), "A again");
}

#[test]
fn mutating_commands_are_all_scoped_to_the_calling_window() {
    let app = test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);

    let in_a = format!("{root_a}/created-by-b.md");
    assert!(invoke(&win_b, "create_file", json!({ "path": in_a })).is_err());
    assert!(!Path::new(&in_a).exists());

    let note_a = format!("{root_a}/a.md");
    assert!(invoke(&win_b, "trash_path", json!({ "path": note_a })).is_err());
    assert!(Path::new(&note_a).exists());

    assert!(invoke(
        &win_b,
        "list_directory",
        json!({ "path": root_a, "options": null })
    )
    .is_err());
    assert!(invoke(
        &win_b,
        "list_markdown_notes",
        json!({ "root": root_a, "options": null })
    )
    .is_err());
    assert!(invoke(
        &win_b,
        "search_vault",
        json!({ "root": root_a, "query": "in", "options": null })
    )
    .is_err());
    assert!(invoke(
        &win_b,
        "write_chat",
        json!({ "vaultPath": root_a, "id": "c1", "data": { "title": "x" } })
    )
    .is_err());
    assert!(!Path::new(&root_a).join(".mdwriter").exists());
    assert!(invoke(&win_b, "list_skills", json!({ "rootPath": root_a })).is_err());
}

/// Args for `start_ai_session` as the frontend sends them.
fn ai_session_args(agent: &str, vault_path: &str) -> serde_json::Value {
    json!({
        "agent": agent,
        "prompt": "summarize my notes",
        "vaultPath": vault_path,
        "permissionMode": null,
    })
}

#[test]
fn an_agent_cannot_be_started_in_another_windows_vault() {
    // The AI agent runs as a subprocess with `current_dir(vault_path)` and full
    // write access under it. `vault_path` is webview-supplied, so without a
    // scope check window B could aim an LLM at window A's vault — the same
    // cross-window mutation every filesystem command already refuses.
    let app = test_app();
    let (_a, root_a, note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);

    let err = invoke(&win_b, "start_ai_session", ai_session_args("claude-code", &root_a))
        .expect_err("window B must not start an agent in window A's vault");
    // The rejection is the *scope* check, not an incidental "claude isn't
    // installed" — which also pins the ordering: the guard runs before the
    // adapter is resolved, so on a machine that does have the binary there is
    // still no window in which a subprocess could have been spawned.
    assert!(
        err.contains("outside active vault"),
        "expected a vault-scope rejection, got: {err}"
    );

    // A file inside A's vault is refused too, not just the root itself.
    let err = invoke(&win_b, "start_ai_session", ai_session_args("claude-code", &note_a))
        .expect_err("window B must not start an agent inside window A's vault");
    assert!(
        err.contains("outside active vault"),
        "expected a vault-scope rejection, got: {err}"
    );
}

#[test]
fn an_agent_cannot_be_started_by_a_window_with_no_vault_open() {
    let app = test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);

    // B never called list_tree, so it has no scope and nothing is in bounds —
    // including its own home directory.
    let err = invoke(&win_b, "start_ai_session", ai_session_args("claude-code", &root_a))
        .expect_err("a scopeless window must not start an agent");
    assert!(err.contains("no active vault"), "unexpected error: {err}");
}

#[test]
fn an_agent_started_in_the_windows_own_vault_passes_the_scope_check() {
    // Control for the two rejections above: with the caller's *own* vault the
    // guard lets the call through and it fails later, on adapter resolution.
    // `open-code` is an unimplemented stub, so this stops at `agent_for`
    // without detecting a binary or spawning anything — but it does reach the
    // session lock on the way there, hence the session-managing app.
    let app = session_test_app();
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_b = window(&app, "b");
    open_vault(&win_b, &root_b);

    let err = invoke(&win_b, "start_ai_session", ai_session_args("open-code", &root_b))
        .expect_err("the stub adapter cannot run");
    assert!(
        err.contains("not yet implemented"),
        "expected to get past the scope check, got: {err}"
    );
    // And the same stub agent aimed outside the vault never reaches the adapter.
    let (_other, root_other, _note_other) = vault_with_note("c.md", "in c");
    let err = invoke(&win_b, "start_ai_session", ai_session_args("open-code", &root_other))
        .expect_err("out-of-scope vault is refused regardless of agent");
    assert!(
        err.contains("outside active vault"),
        "expected a vault-scope rejection, got: {err}"
    );
}

#[test]
fn a_window_cannot_watch_a_directory_outside_its_own_vault() {
    // `start_watcher` takes a root from the webview like any other path
    // argument. A window watching a directory it has no scope over gets a live
    // feed of activity in it (existence and change probing), so the root is
    // validated against the caller's own vault.
    let app = test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);

    let err = invoke(&win_b, "start_watcher", json!({ "root": root_a }))
        .expect_err("window B must not watch window A's vault");
    assert!(
        err.contains("outside active vault"),
        "expected a vault-scope rejection, got: {err}"
    );

    let state = app.state::<AppState>();
    // No watcher was installed for B, and A's is untouched.
    assert!(state.get("b").unwrap().watcher.lock().unwrap().is_none());
    invoke(&win_b, "start_watcher", json!({ "root": root_b })).expect("B watches its own vault");
    assert!(state.get("b").unwrap().watcher.lock().unwrap().is_some());
}

#[test]
fn reopening_a_vault_in_one_window_does_not_move_the_other_windows_scope() {
    // S1.3: navigating window A to a different folder must leave B pointed at
    // its own vault — the scope is per label, not process-wide.
    let app = test_app();
    let (_first, root_first, _note_first) = vault_with_note("first.md", "first");
    let (_second, root_second, note_second) = vault_with_note("second.md", "second");
    let (_b, root_b, note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_first);
    open_vault(&win_b, &root_b);

    open_vault(&win_a, &root_second);

    assert_eq!(read_text(&win_a, &note_second).unwrap(), "second");
    assert_eq!(read_text(&win_b, &note_b).unwrap(), "in b");
    assert!(read_text(&win_b, &note_second).is_err());
}

#[test]
fn a_window_with_no_vault_open_cannot_read_anything() {
    let app = test_app();
    let (_a, root_a, note_a) = vault_with_note("a.md", "in a");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);

    // B has never called list_tree: no scope, so nothing is in bounds.
    assert!(read_text(&win_b, &note_a).is_err());
}

#[test]
fn stopping_one_windows_watcher_leaves_the_others_running() {
    // S3.1 through the real IPC path: each `start_watcher` must install under
    // the calling window's label, and B tearing its watcher down must not take
    // A's watcher (or A's vault scope) with it.
    let app = test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);

    invoke(&win_a, "start_watcher", json!({ "root": root_a })).unwrap();
    invoke(&win_b, "start_watcher", json!({ "root": root_b })).unwrap();
    let state = app.state::<AppState>();
    assert!(state.get("a").unwrap().watcher.lock().unwrap().is_some());
    assert!(state.get("b").unwrap().watcher.lock().unwrap().is_some());

    invoke(&win_b, "stop_watcher", json!({})).unwrap();

    assert!(state.get("a").unwrap().watcher.lock().unwrap().is_some());
    assert!(state.get("b").unwrap().watcher.lock().unwrap().is_none());
    // A's vault scope survives too — B closing its vault must not un-scope A.
    assert_eq!(
        state.get("a").unwrap().active_vault_root().unwrap(),
        Path::new(&root_a)
    );
    assert!(state.get("b").unwrap().active_vault_root().is_err());
}

/// Count how many times a labelled listener fires. Mirrors the frontend, which
/// listens through the current webview window (`EventTarget::WebviewWindow`)
/// rather than the default `listen()` (`EventTarget::Any`).
fn count_labelled(window: &WebviewWindow<MockRuntime>, event: &str) -> Arc<AtomicUsize> {
    let hits = Arc::new(AtomicUsize::new(0));
    let sink = Arc::clone(&hits);
    window.listen(event.to_string(), move |_event| {
        sink.fetch_add(1, Ordering::SeqCst);
    });
    hits
}

#[test]
fn a_vault_changed_event_reaches_only_the_window_it_is_addressed_to() {
    // S1.3 acceptance: the watcher for window A's vault must not wake B's
    // watcher handler (which would refresh B's tree and reload B's open doc).
    let app = test_app();
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    let hits_a = count_labelled(&win_a, "vault-changed");
    let hits_b = count_labelled(&win_b, "vault-changed");

    // Exactly what `start_watcher`'s debounce callback does.
    app.emit_to(
        "a",
        "vault-changed",
        commands::watch::VaultChangeEvent {
            paths: vec!["/vault-a/note.md".into()],
        },
    )
    .unwrap();

    assert_eq!(hits_a.load(Ordering::SeqCst), 1);
    assert_eq!(hits_b.load(Ordering::SeqCst), 0, "window B heard A's watcher");

    app.emit_to(
        "b",
        "vault-changed",
        commands::watch::VaultChangeEvent {
            paths: vec!["/vault-b/note.md".into()],
        },
    )
    .unwrap();

    assert_eq!(hits_a.load(Ordering::SeqCst), 1);
    assert_eq!(hits_b.load(Ordering::SeqCst), 1);
}

#[test]
fn a_menu_event_reaches_only_the_addressed_window() {
    let app = test_app();
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    let hits_a = count_labelled(&win_a, "menu:settings");
    let hits_b = count_labelled(&win_b, "menu:settings");

    app.emit_to("b", "menu:settings", ()).unwrap();

    assert_eq!(hits_a.load(Ordering::SeqCst), 0);
    assert_eq!(hits_b.load(Ordering::SeqCst), 1);
}

#[test]
fn an_any_target_listener_defeats_addressed_emits() {
    // Guard rail for the frontend contract, and the reason the JS listeners had
    // to change too: Tauri delivers to `EventTarget::Any` listeners regardless
    // of the emit target (see `match_any_or_filter` in tauri's listener.rs).
    // A bare `listen("vault-changed", …)` in the webview registers exactly that
    // target, so making the Rust side `emit_to` is necessary but not sufficient.
    let app = test_app();
    let _win_a = window(&app, "a");
    let _win_b = window(&app, "b");
    let hits = Arc::new(AtomicUsize::new(0));
    let sink = Arc::clone(&hits);
    // `listen_any` registers EventTarget::Any — the same target a bare JS
    // `listen()` registers.
    app.listen_any("vault-changed", move |_event| {
        sink.fetch_add(1, Ordering::SeqCst);
    });

    app.emit_to(
        "a",
        "vault-changed",
        commands::watch::VaultChangeEvent { paths: Vec::new() },
    )
    .unwrap();

    assert_eq!(
        hits.load(Ordering::SeqCst),
        1,
        "an Any-target listener is expected to receive addressed emits; \
         if this ever changes, the frontend's labelled listeners are redundant"
    );
}

// ---- window lifecycle over real IPC (S1.1, S1.5, S3.1) --------------------
//
// Same premise as above — the label comes from the calling window, not from an
// argument — applied to the lifecycle commands.
//
// Teardown is driven here through `close_window`, which is what actually
// finishes a close in production (the frontend intercepts close-requested to
// flush, and that interception makes tauri prevent the close for good). The
// mock runtime has no event loop, so the `Destroyed` run event that also
// releases state cannot be emitted; what these tests observe is the state
// release `close_window` performs alongside the destroy, which is absent
// precisely when the decision goes wrong and the window is merely hidden.

#[test]
fn open_new_window_adds_a_window_without_disturbing_the_existing_one() {
    // S1.1: the new window exists, has its own label and its own state, and the
    // window it was opened from keeps the vault it had open.
    let app = test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let win_a = window(&app, "main");
    open_vault(&win_a, &root_a);

    let label = invoke(&win_a, "open_new_window", json!({}))
        .expect("a new window opens")
        .as_str()
        .expect("the command returns the new label")
        .to_string();

    assert!(
        label.starts_with("w-"),
        "runtime windows get generated labels, got {label}"
    );
    assert_ne!(label, "main");
    assert!(
        app.get_webview_window(&label).is_some(),
        "the window was reported but not created"
    );
    let state = app.state::<AppState>();
    // Registered (so a first IPC call from it isn't treated as a late call from
    // a destroyed window) and empty (S1.2 — a new window starts with no vault).
    assert!(state.get(&label).is_some(), "state was not claimed");
    assert!(state.get(&label).unwrap().active_vault_root().is_err());
    // The window that opened it is untouched.
    assert_eq!(
        state.get("main").unwrap().active_vault_root().unwrap(),
        Path::new(&root_a)
    );
    assert!(app.get_webview_window("main").is_some());
}

#[test]
fn open_new_window_twice_yields_two_distinct_windows() {
    let app = test_app();
    let win_a = window(&app, "main");

    let first = invoke(&win_a, "open_new_window", json!({})).unwrap();
    let second = invoke(&win_a, "open_new_window", json!({})).unwrap();

    assert_ne!(first, second, "the second window reused the first's label");
    let state = app.state::<AppState>();
    // Two independent state slots, one per new window. ("main" has none yet —
    // state is claimed on window creation or first command, and this `main` was
    // built directly by the test harness rather than through the lifecycle.)
    let labels = state.labels();
    assert_eq!(labels.len(), 2, "labels: {labels:?}");
    for label in [&first, &second] {
        let label = label.as_str().unwrap();
        assert!(labels.iter().any(|known| known == label));
        assert!(app.get_webview_window(label).is_some());
    }
}

#[test]
fn find_vault_window_names_the_other_window_holding_the_vault() {
    // S1.5: window B asking to open A's vault is told to focus A. The answer is
    // derived from the *calling* window's label, not from an argument.
    let app = test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);

    assert_eq!(
        invoke(&win_b, "find_vault_window", json!({ "path": root_a })).unwrap(),
        json!("a")
    );
    // A asking about its own vault is not a duplicate — it just reloads.
    assert_eq!(
        invoke(&win_a, "find_vault_window", json!({ "path": root_a })).unwrap(),
        json!(null)
    );
}

#[test]
fn find_vault_window_ignores_vaults_nobody_has_open() {
    let app = test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);

    assert_eq!(
        invoke(&win_b, "find_vault_window", json!({ "path": root_b })).unwrap(),
        json!(null)
    );
}

#[test]
fn closing_a_window_over_real_ipc_releases_that_windows_state() {
    // The gap this closes: the *frontend* intercepts close-requested (to flush
    // the autosave), which makes tauri prevent the close permanently, so the
    // close is only ever finished by this command. When it hid the window
    // instead of destroying it, `WindowEvent::Destroyed` never fired and nothing
    // ran the S3.1/S3.2 teardown — the watcher, the autosave loop and the vault
    // claim all outlived the window for the life of the process.
    //
    // This drives `close_window` through the real command dispatcher as the
    // closing window, so it fails if the decision ever goes back to "hide".
    let app = test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "main");
    let win_b = window(&app, "w-second");
    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);
    invoke(&win_a, "start_watcher", json!({ "root": root_a })).unwrap();
    invoke(&win_b, "start_watcher", json!({ "root": root_b })).unwrap();
    let state = app.state::<AppState>();
    assert!(state.get("main").unwrap().watcher.lock().unwrap().is_some());

    invoke(&win_a, "close_window", json!({})).expect("the close completes");

    // S3.2: the closed window's state — and with it its FSEvents subscription —
    // is gone, not parked in the map with no window left to drop it.
    assert!(
        state.get("main").is_none(),
        "the closed window kept its watcher and its vault claim"
    );
    // S1.5: and its vault is free, so opening it elsewhere is not bounced to a
    // window that is no longer there.
    assert_eq!(
        invoke(&win_b, "find_vault_window", json!({ "path": root_a })).unwrap(),
        json!(null)
    );
    // S3.1: the surviving window is untouched — same vault, same live watcher.
    let survivor = state.get("w-second").expect("window B is still open");
    assert!(
        survivor.watcher.lock().unwrap().is_some(),
        "closing A stopped B watching its vault"
    );
    assert_eq!(survivor.active_vault_root().unwrap(), Path::new(&root_b));
    let note_b = format!("{root_b}/b.md");
    assert_eq!(read_text(&win_b, &note_b).unwrap(), "in b");
}

#[test]
fn closing_the_only_window_keeps_it_reusable_on_macos() {
    // S3.4: the last window is the one case where hiding is right — the macOS
    // app stays running with no window open and reveals this one again from the
    // Dock, so its state (vault + watcher) has to survive. Everywhere else the
    // last window closing is the app going away, and it is torn down like any
    // other window.
    let app = test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let win_a = window(&app, "main");
    open_vault(&win_a, &root_a);
    invoke(&win_a, "start_watcher", json!({ "root": root_a })).unwrap();

    invoke(&win_a, "close_window", json!({})).expect("the close completes");

    let state = app.state::<AppState>();
    if cfg!(target_os = "macos") {
        let kept = state.get("main").expect("the last window stays reusable");
        assert!(kept.watcher.lock().unwrap().is_some());
        assert_eq!(kept.active_vault_root().unwrap(), Path::new(&root_a));
    } else {
        assert!(state.get("main").is_none());
    }
}

#[test]
fn focusing_a_window_that_does_not_exist_is_an_error() {
    // The frontend aborts its own open when the focus hand-off succeeds, so a
    // silent success for a dead label would leave the vault opened nowhere.
    let app = test_app();
    let win_a = window(&app, "a");

    assert!(invoke(&win_a, "focus_window", json!({ "label": "ghost" })).is_err());
    assert!(invoke(&win_a, "focus_window", json!({ "label": "a" })).is_ok());
}

// ---- P4: the AI/agent channel is scoped to one window ----------------------
//
// There is one agent session for the whole process, owned by the window that
// started it. Three things have to hold, and each is a distinct failure:
//
//  1. Its events are *addressed* to the owner, or every window renders its
//     tokens and its approval cards.
//  2. Its commands are *gated* on the owner, or window B can approve a tool
//     call that writes into window A's vault — laundering a write past the
//     per-window scope guard `start_ai_session` installs.
//  3. The lock is *released* on every path, including the owner window dying,
//     or no window can ever start an agent again.

/// Set the session owner directly. Stands in for "window `label` has a live
/// session", without spawning an agent.
fn claim_session(app: &App<MockRuntime>, label: &str) {
    assert!(matches!(
        app.state::<AgentSession>().try_claim(label, &|_| true),
        crate::commands::agents::Claim::Acquired { .. }
    ));
}

#[test]
fn stream_events_reach_only_the_window_that_owns_the_session() {
    // Production path: the stdout/stderr readers and the subprocess waiter all
    // emit through `emit_stream` with the owning window's label.
    let app = session_test_app();
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    let hits_a = count_labelled(&win_a, "ai-stream");
    let hits_b = count_labelled(&win_b, "ai-stream");

    commands::agents::emit_stream(
        app.handle(),
        "a",
        commands::agents::AiStreamEvent::Text {
            text: "hello".into(),
        },
    );
    // The terminal event matters most: a window that receives another window's
    // `Done` clears its own in-flight state and stops rendering its own turn.
    commands::agents::emit_stream(
        app.handle(),
        "a",
        commands::agents::AiStreamEvent::Done { usage: None },
    );

    assert_eq!(hits_a.load(Ordering::SeqCst), 2);
    assert_eq!(
        hits_b.load(Ordering::SeqCst),
        0,
        "window B rendered window A's agent output"
    );
}

#[test]
fn permission_requests_reach_only_the_window_that_owns_the_session() {
    // An approval card in the wrong window is answerable from the wrong window:
    // `respond_permission` resolves by opaque id against the one broker.
    let app = session_test_app();
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    let hits_a = count_labelled(&win_a, "ai-permission");
    let hits_b = count_labelled(&win_b, "ai-permission");

    commands::agents::permission::claude_mcp::emit_permission_request(
        app.handle(),
        "a",
        &commands::agents::permission::claude_mcp::PermissionEvent {
            id: "req-1".into(),
            tool: "Write".into(),
            input: json!({ "file_path": "/vault-a/note.md" }),
            tool_use_id: None,
        },
    );

    assert_eq!(hits_a.load(Ordering::SeqCst), 1);
    assert_eq!(
        hits_b.load(Ordering::SeqCst),
        0,
        "window B was offered an approval card for window A's vault"
    );
}

#[test]
fn a_second_window_cannot_start_an_agent_while_one_is_running() {
    // Before the lock this silently killed the running turn and took the
    // session over. The error has to name the owner so the UI can offer
    // "Focus" instead of a dead end.
    let app = session_test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);
    claim_session(&app, "a");

    // B asks for an agent *in its own vault* — perfectly in scope, and still
    // refused, because the single subprocess is A's.
    let err = invoke(&win_b, "start_ai_session", ai_session_args("open-code", &root_b))
        .expect_err("window B must not take over window A's session");
    assert!(
        err.contains("AgentBusy") && err.contains("\"ownerLabel\":\"a\""),
        "expected a typed AgentBusy naming window a, got: {err}"
    );
    // The owner's vault rides along so the panel can say *which* vault is busy.
    assert!(err.contains(&root_a), "expected the owner's vault, got: {err}");
    // A still owns it: a refused claim must not have stolen the lock.
    assert_eq!(app.state::<AgentSession>().owner().as_deref(), Some("a"));
}

#[test]
fn the_owning_window_can_still_start_its_next_turn() {
    // Control for the refusal above: same-window re-entry is not "busy", it is
    // takeover of its own turn, so it gets past the lock and fails later on the
    // stub adapter.
    let app = session_test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let win_a = window(&app, "a");
    open_vault(&win_a, &root_a);
    claim_session(&app, "a");

    let err = invoke(&win_a, "start_ai_session", ai_session_args("open-code", &root_a))
        .expect_err("the stub adapter cannot run");
    assert!(
        err.contains("not yet implemented"),
        "the owner was refused its own session: {err}"
    );
    // And it still owns the session it walked in with. The re-entry failed
    // before anything was killed, so the lock still belongs to the turn that is
    // (as far as this state knows) still running.
    assert_eq!(
        app.state::<AgentSession>().owner().as_deref(),
        Some("a"),
        "a failed re-entry handed away the owner's lock"
    );
}

#[test]
fn a_failed_re_entry_does_not_release_a_live_session() {
    // The teeth of the assertion above. `start_ai_session` releases the claim
    // when the spawn fails — correct for a *fresh* claim, catastrophic for a
    // re-entry, because the lock it would hand back belongs to a subprocess that
    // is still running. A real child stands in for `claude`: if the release is
    // ungated, window B claims the freed lock and `spawn_claimed_session`'s
    // unconditional `kill_running` kills a turn B's user never started, while
    // A's waiter never emits a terminal Done.
    let app = session_test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);
    claim_session(&app, "a");
    let child = Arc::new(std::sync::Mutex::new(
        std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 120"])
            .spawn()
            .expect("stand-in agent subprocess spawns"),
    ));
    *app.state::<AgentSession>().process.lock().unwrap() = Some(Arc::clone(&child));

    // A's follow-up prompt names an agent that cannot start. Same window, so it
    // gets past the lock as a re-entry and then fails.
    let err = invoke(&win_a, "start_ai_session", ai_session_args("open-code", &root_a))
        .expect_err("the stub adapter cannot run");
    assert!(err.contains("not yet implemented"), "unexpected error: {err}");

    assert_eq!(
        app.state::<AgentSession>().owner().as_deref(),
        Some("a"),
        "a failed re-entry released the lock while A's subprocess was still running"
    );
    // The live turn is untouched: still the same child, still running.
    assert!(
        app.state::<AgentSession>()
            .process
            .lock()
            .unwrap()
            .is_some(),
        "a failed re-entry tore down the running session's process handle"
    );
    assert!(
        matches!(child.lock().unwrap().try_wait(), Ok(None)),
        "a failed re-entry killed the running subprocess"
    );
    // The consequence B would have seen: it is still refused, by name.
    let err = invoke(&win_b, "start_ai_session", ai_session_args("open-code", &root_b))
        .expect_err("window B must not inherit a lock A never gave up");
    assert!(
        err.contains("AgentBusy") && err.contains("\"ownerLabel\":\"a\""),
        "expected a typed AgentBusy naming window a, got: {err}"
    );
    assert!(
        matches!(child.lock().unwrap().try_wait(), Ok(None)),
        "window B's refused start killed A's subprocess anyway"
    );

    let _ = child.lock().unwrap().kill();
    let _ = child.lock().unwrap().wait();
}

#[test]
fn a_session_that_fails_to_start_does_not_hold_the_lock() {
    // The claim is taken before the adapter is resolved (so the refusal is
    // cheap). Every failure past that point therefore has to hand it back, or a
    // single failed send would tell every other window "busy" for the life of
    // the process.
    let app = session_test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);

    invoke(&win_a, "start_ai_session", ai_session_args("open-code", &root_a))
        .expect_err("the stub adapter cannot run");

    assert_eq!(
        app.state::<AgentSession>().owner(),
        None,
        "a failed start left the session locked"
    );
    // And B can now claim it — the observable consequence.
    let err = invoke(&win_b, "start_ai_session", ai_session_args("open-code", &root_b))
        .expect_err("the stub adapter cannot run");
    assert!(err.contains("not yet implemented"), "unexpected error: {err}");
}

#[test]
fn a_non_owning_window_cannot_stop_the_session() {
    let app = session_test_app();
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    claim_session(&app, "a");

    let err = invoke(&win_b, "stop_ai_session", json!({}))
        .expect_err("window B must not cancel window A's turn");
    assert!(err.contains("AgentBusy"), "unexpected error: {err}");
    assert_eq!(app.state::<AgentSession>().owner().as_deref(), Some("a"));

    // The owner's own stop works, and releases the lock.
    invoke(&win_a, "stop_ai_session", json!({})).expect("the owner can stop");
    assert_eq!(app.state::<AgentSession>().owner(), None);
    // With no session at all, stopping is a harmless no-op — the frontend
    // cancels optimistically.
    invoke(&win_b, "stop_ai_session", json!({})).expect("stopping nothing is fine");
}

#[test]
fn a_non_owning_window_cannot_answer_a_permission_request() {
    // The privilege leak this closes: the tool call being approved runs with its
    // cwd inside the *owner's* vault. An id is all it takes, and ids are opaque.
    let app = session_test_app();
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    claim_session(&app, "a");

    let err = invoke(
        &win_b,
        "respond_permission",
        json!({
            "id": "req-1",
            "decision": "allow",
            "message": null,
            "updatedInput": null,
        }),
    )
    .expect_err("window B must not approve a tool call in window A's vault");
    assert!(err.contains("AgentBusy"), "unexpected error: {err}");

    // The owner is allowed through the gate; `false` because this mock session
    // has no broker holding that id.
    assert_eq!(
        invoke(
            &win_a,
            "respond_permission",
            json!({
                "id": "req-1",
                "decision": "allow",
                "message": null,
                "updatedInput": null,
            }),
        )
        .unwrap(),
        json!(false)
    );
}

#[test]
fn a_non_owning_window_cannot_add_an_allow_rule() {
    // Worse than a single approval: an allow rule is a standing approval for the
    // rest of the owner's session.
    let app = session_test_app();
    let win_a = window(&app, "a");
    let win_b = window(&app, "b");
    claim_session(&app, "a");

    let err = invoke(
        &win_b,
        "add_permission_rule",
        json!({ "tool": "Bash", "pathPrefix": null }),
    )
    .expect_err("window B must not blanket-allow Bash in window A's session");
    assert!(err.contains("AgentBusy"), "unexpected error: {err}");

    assert_eq!(
        invoke(
            &win_a,
            "add_permission_rule",
            json!({ "tool": "Bash", "pathPrefix": null }),
        )
        .unwrap(),
        json!(false),
        "the owner should reach the (absent) broker rather than the gate"
    );
}

#[test]
fn a_session_owned_by_a_window_that_is_gone_is_reaped_not_honored() {
    // The wedge case, from the command side: the owner window was destroyed
    // without the destroy path running (a crashed webview, a close that never
    // reached `close_window`). A dead label can never release the lock itself,
    // so honoring it would block every window forever.
    let app = session_test_app();
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_b = window(&app, "b");
    open_vault(&win_b, &root_b);
    // "ghost" never existed as a window.
    claim_session(&app, "ghost");

    // Ownership-gated commands treat it as "no session".
    invoke(&win_b, "stop_ai_session", json!({})).expect("a dead owner must not veto a stop");
    assert_eq!(app.state::<AgentSession>().owner(), None);

    claim_session(&app, "ghost");
    let err = invoke(&win_b, "start_ai_session", ai_session_args("open-code", &root_b))
        .expect_err("the stub adapter cannot run");
    assert!(
        err.contains("not yet implemented"),
        "a dead owner wedged the session lock: {err}"
    );
}

#[test]
fn a_failed_start_reaps_the_subprocess_of_the_dead_window_it_stole_the_lock_from() {
    // S3.2, the case the close path can't cover: the owning window died without
    // its destroy hook running, so its `claude` is still alive with no UI
    // attached. `start_ai_session` steals that stale lock, but the kill of the
    // inherited child lives in `spawn_claimed_session` — so a failure *between*
    // the steal and the spawn (agent not implemented, binary missing) used to
    // release the lock and walk away from the process.
    //
    // That leaves the orphan unreachable rather than merely leaked: with
    // `owner == None`, `owns_session` reports "no session", so `stop_ai_session`
    // returns Ok as a no-op from every window and no UI can ever kill it.
    let app = session_test_app();
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_b = window(&app, "b");
    open_vault(&win_b, &root_b);
    // "ghost" holds the lock and a live subprocess, and never was a window.
    claim_session(&app, "ghost");
    let child = Arc::new(std::sync::Mutex::new(
        std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 120"])
            .spawn()
            .expect("stand-in agent subprocess spawns"),
    ));
    *app.state::<AgentSession>().process.lock().unwrap() = Some(Arc::clone(&child));

    // B's start steals the stale lock, then fails on the stub adapter.
    let err = invoke(&win_b, "start_ai_session", ai_session_args("open-code", &root_b))
        .expect_err("the stub adapter cannot run");
    assert!(err.contains("not yet implemented"), "unexpected error: {err}");

    // The lock still goes back — B's failed start owns nothing.
    assert_eq!(
        app.state::<AgentSession>().owner(),
        None,
        "a failed start kept the lock it stole from a dead window"
    );
    // `wait_for_exit` first: it kills the stand-in if the assertion is about to
    // fail, so a regression doesn't leave a stray `sleep` behind.
    assert!(
        wait_for_exit(&child),
        "the dead window's subprocess was orphaned: no window owns the session, \
         so no window can stop it"
    );
    assert!(
        app.state::<AgentSession>()
            .process
            .lock()
            .unwrap()
            .is_none(),
        "the dead window's process handle survived the steal, pointing at a child nothing owns"
    );
    // And the observable end state: stopping is a no-op because there is
    // genuinely nothing left to stop.
    invoke(&win_b, "stop_ai_session", json!({})).expect("stopping nothing is fine");
}

#[test]
fn closing_the_owning_window_kills_its_agent_and_frees_the_lock() {
    // S3.2, agent edition: the closing window's subprocess has just lost the
    // only UI attached to it. A real child process stands in for `claude` — if
    // the close path stops killing it, this test hangs on a live process rather
    // than passing quietly.
    let app = session_test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "main");
    let win_b = window(&app, "w-second");
    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);
    claim_session(&app, "main");
    let child = std::sync::Arc::new(std::sync::Mutex::new(
        std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 120"])
            .spawn()
            .expect("stand-in agent subprocess spawns"),
    ));
    *app.state::<AgentSession>().process.lock().unwrap() = Some(std::sync::Arc::clone(&child));

    invoke(&win_a, "close_window", json!({})).expect("the close completes");

    assert_eq!(
        app.state::<AgentSession>().owner(),
        None,
        "the closed window kept the session lock"
    );
    assert!(
        app.state::<AgentSession>()
            .process
            .lock()
            .unwrap()
            .is_none(),
        "the closed window's session handle outlived it"
    );
    let exited = wait_for_exit(&child);
    assert!(exited, "closing the owning window orphaned its subprocess");
}

#[test]
fn closing_a_window_that_owns_nothing_leaves_the_running_session_alone() {
    // The other half: B closing must not cancel A's turn.
    let app = session_test_app();
    let (_a, root_a, _note_a) = vault_with_note("a.md", "in a");
    let (_b, root_b, _note_b) = vault_with_note("b.md", "in b");
    let win_a = window(&app, "main");
    let win_b = window(&app, "w-second");
    open_vault(&win_a, &root_a);
    open_vault(&win_b, &root_b);
    claim_session(&app, "main");

    invoke(&win_b, "close_window", json!({})).expect("the close completes");

    assert_eq!(
        app.state::<AgentSession>().owner().as_deref(),
        Some("main"),
        "closing a bystander window cancelled the owner's session"
    );
}

/// Poll for the stand-in subprocess to exit. `kill` is asynchronous — the
/// process is signalled, and reaped whenever the OS gets to it.
fn wait_for_exit(child: &std::sync::Arc<std::sync::Mutex<std::process::Child>>) -> bool {
    for _ in 0..200 {
        if let Ok(Some(_)) = child.lock().unwrap().try_wait() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    // Don't leave a stray `sleep` behind if the assertion is about to fail.
    let _ = child.lock().unwrap().kill();
    false
}
