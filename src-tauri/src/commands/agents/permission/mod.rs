//! Inline per-tool permission approval.
//!
//! Each AI session gets its own [`PermissionBroker`]. The mechanism for
//! pausing the agent mid-turn is adapter-specific — Claude Code uses
//! `--permission-prompt-tool` against an MCP server; Codex's sandbox
//! model isn't MCP-shaped and gets its own impl later — so the trait is
//! the only common shape.
//!
//! The Claude Code broker runs an embedded MCP server out of the same
//! binary, env-switched at the top of `lib::run`, rather than a Tauri
//! sidecar. Sidecar bundling requires triple-named copies plus a
//! pre-build step in both `beforeDev` and `beforeBuild`, all to ship a
//! second binary with the same dep tree — embedded gets the same
//! outcome with zero bundling churn. Splitting back out is a one-day
//! change behind this trait if it ever matters.

pub mod claude_mcp;
pub mod embedded_mcp;

use serde::{Deserialize, Serialize};

use super::AgentCommand;
use tauri::AppHandle;

/// Decision the UI surfaces back to a blocked tool call.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DecisionKind {
    Allow,
    Deny,
}

/// Wire form passed from `respond_permission` to whichever broker owns
/// the pending request. `updated_input` is optional and only honored by
/// brokers that support tool-input rewriting (Claude Code does).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    pub id: String,
    pub decision: DecisionKind,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub updated_input: Option<serde_json::Value>,
}

impl Decision {
    pub fn allow(id: impl Into<String>) -> Self {
        Self { id: id.into(), decision: DecisionKind::Allow, message: None, updated_input: None }
    }
    pub fn deny(id: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            decision: DecisionKind::Deny,
            message: Some(message.into()),
            updated_input: None,
        }
    }
}

/// Per-session permission gate. Implementations carry whatever transport
/// state they need (sockets, ports, tokens) and clean themselves up on
/// drop.
pub trait PermissionBroker: Send + Sync {
    /// Mutate the [`AgentCommand`] to wire the broker — add flags, env
    /// vars, generated config files, etc.
    fn wire(&self, cmd: &mut AgentCommand);

    /// Hand a decision from the UI to whichever request is waiting on it.
    /// Returns `false` if the request id is unknown (e.g. resolved twice).
    fn respond(&self, decision: Decision) -> bool;

    /// Force-deny every pending request. Idempotent. Called when the
    /// session is cancelled or the agent subprocess exits.
    fn shutdown(&self);

    /// Extend the broker's session allowlist. Implementations that don't
    /// support allowlisting (e.g. an adapter where every approval is
    /// one-shot) return `false`. Default is no-op so adapters opt in.
    fn add_allow_rule(&self, _tool: &str, _path_prefix: Option<&str>) -> bool { false }
}

/// Construct the right broker for a given agent. Returns `None` for
/// agents that don't (yet) support inline permission prompts; callers
/// fall back to whatever behavior the adapter has by itself.
///
/// `Arc<dyn PermissionBroker>` rather than `Box` so the session state,
/// the cancel command, and the subprocess waiter can each hold a clone
/// — there's no single owner.
///
/// `owner_label` is the window that owns the session; the broker addresses its
/// approval events there instead of broadcasting them.
pub fn broker_for<R: tauri::Runtime>(
    agent: super::AgentId,
    app: AppHandle<R>,
    owner_label: String,
) -> std::io::Result<Option<std::sync::Arc<dyn PermissionBroker>>> {
    match agent {
        super::AgentId::ClaudeCode => {
            let exe = std::env::current_exe()?;
            let broker = claude_mcp::ClaudeCodeMcpBroker::spawn(app, exe, owner_label)?;
            Ok(Some(std::sync::Arc::new(broker)))
        }
        // Codex's approval model isn't MCP-shaped; its broker is a
        // future implementation that hooks into Codex's own protocol.
        super::AgentId::Codex => Ok(None),
        super::AgentId::OpenCode | super::AgentId::Pi | super::AgentId::Gemini => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_decision_serializes_minimally() {
        let d = Decision::allow("abc");
        let s = serde_json::to_string(&d).unwrap();
        assert!(s.contains(r#""decision":"allow""#));
        assert!(!s.contains("message"));
        assert!(!s.contains("updated_input"));
    }

    #[test]
    fn deny_decision_carries_message() {
        let d = Decision::deny("abc", "no thanks");
        let s = serde_json::to_string(&d).unwrap();
        assert!(s.contains(r#""decision":"deny""#));
        assert!(s.contains("no thanks"));
    }
}
