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

use crate::errors::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

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

/// Where the running subprocess lives, so we can kill it.
#[derive(Default)]
pub struct AgentSession {
    pub process: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
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
        // Other agents are stubs until their adapters are written.
        AgentId::Codex
        | AgentId::OpenCode
        | AgentId::Pi
        | AgentId::Gemini => None,
    }
}

/// Aggressive PATH-extending search for a binary. Looks in PATH plus a list
/// of well-known fallback locations because GUI apps on macOS inherit a thin
/// PATH that misses Homebrew, mise, asdf, npm-global, ~/.claude/local, etc.
pub fn which(binary: &str) -> Option<PathBuf> {
    use std::env;

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(p) = env::var("PATH") {
        for dir in env::split_paths(&p) {
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

    candidates.into_iter().find(|p| p.is_file())
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

#[tauri::command]
pub async fn start_ai_session(
    app: AppHandle,
    agent: AgentId,
    prompt: String,
    vault_path: PathBuf,
) -> Result<()> {
    use tauri_plugin_shell::process::CommandEvent;
    use tauri_plugin_shell::ShellExt;

    let adapter = agent_for(agent).ok_or_else(|| {
        AppError::Io(format!("Agent '{}' is not yet implemented.", agent.label()))
    })?;

    let binary = adapter
        .detect()
        .ok_or_else(|| AppError::Io(format!("'{}' binary was not found on this machine.", agent.label())))?;

    // Stop any session already running.
    let prev = app.state::<AgentSession>().process.lock().unwrap().take();
    if let Some(child) = prev {
        let _ = child.kill();
    }

    let cmd = adapter.build_command(&binary, &vault_path, &prompt);

    let mut shell_cmd = app.shell().command(cmd.binary.to_string_lossy().to_string());
    shell_cmd = shell_cmd.args(&cmd.args).current_dir(&vault_path);
    for (k, v) in &cmd.env {
        shell_cmd = shell_cmd.env(k, v);
    }

    let (mut rx, child) = shell_cmd
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to spawn {}: {}", agent.label(), e)))?;

    *app.state::<AgentSession>().process.lock().unwrap() = Some(child);

    let app_emit = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.split('\n') {
                        let line = line.trim_end_matches('\r');
                        if line.is_empty() { continue; }
                        for ev in adapter.parse_line(line) {
                            let _ = app_emit.emit("ai-stream", ev);
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let text = String::from_utf8_lossy(&bytes).to_string();
                    if !text.trim().is_empty() {
                        let _ = app_emit.emit(
                            "ai-stream",
                            AiStreamEvent::Error { message: text },
                        );
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let _ = app_emit.emit(
                        "ai-stream",
                        AiStreamEvent::Done {
                            usage: payload.code.map(|c| serde_json::json!({ "exit_code": c })),
                        },
                    );
                    break;
                }
                CommandEvent::Error(e) => {
                    let _ = app_emit.emit(
                        "ai-stream",
                        AiStreamEvent::Error { message: e },
                    );
                    break;
                }
                _ => {}
            }
        }
        *app_emit.state::<AgentSession>().process.lock().unwrap() = None;
    });

    Ok(())
}

#[tauri::command]
pub fn stop_ai_session(app: AppHandle) -> Result<()> {
    let prev = app.state::<AgentSession>().process.lock().unwrap().take();
    if let Some(child) = prev {
        let _ = child.kill();
    }
    Ok(())
}
