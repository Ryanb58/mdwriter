//! OpenAI Codex CLI adapter.
//!
//! Spawns `codex exec --json <prompt>` and parses the JSONL event stream.
//! Event reference: <https://developers.openai.com/codex/noninteractive>
//!
//! Event shape (newline-delimited JSON, one event per line):
//!   {"type":"thread.started","thread_id":"…"}
//!   {"type":"turn.started"}
//!   {"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}
//!   {"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"…"}}
//!   {"type":"turn.completed","usage":{…}}
//!   {"type":"turn.failed", …}
//!   {"type":"error", …}
//!
//! We translate to the normalized [`AiStreamEvent`] vocabulary so the frontend
//! doesn't have to know which adapter it's talking to.

use super::{Agent, AgentCommand, AiStreamEvent};
use std::path::{Path, PathBuf};

pub struct CodexAgent;

impl Agent for CodexAgent {
    fn detect(&self) -> Option<PathBuf> {
        super::which("codex")
    }

    fn build_command(&self, binary: &Path, _cwd: &Path, prompt: &str) -> AgentCommand {
        // `codex exec` runs non-interactively and `--json` emits the JSONL
        // stream we parse below. We don't pass `--auto` / sandbox flags here;
        // approval behavior is left to the user's `~/.codex/config.toml`.
        AgentCommand {
            binary: binary.to_path_buf(),
            args: vec![
                "exec".into(),
                "--json".into(),
                prompt.to_string(),
            ],
            env: Vec::new(),
        }
    }

    fn parse_line(&self, line: &str) -> Vec<AiStreamEvent> {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            return Vec::new();
        };
        let kind = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match kind {
            "item.started" => parse_item(&value, /*completed=*/ false),
            "item.completed" => parse_item(&value, /*completed=*/ true),
            "turn.completed" => vec![AiStreamEvent::Done {
                usage: value.get("usage").cloned(),
            }],
            "turn.failed" => {
                let msg = value
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "codex turn failed".to_string());
                vec![AiStreamEvent::Error { message: msg }]
            }
            "error" => {
                let msg = value
                    .get("message")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "codex error".to_string());
                vec![AiStreamEvent::Error { message: msg }]
            }
            // thread.started, turn.started — informational, no UI event.
            _ => Vec::new(),
        }
    }
}

fn parse_item(value: &serde_json::Value, completed: bool) -> Vec<AiStreamEvent> {
    let Some(item) = value.get("item") else { return Vec::new(); };
    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();

    match item_type {
        // Final assistant text. Codex emits the entire message at once on
        // completion (no token streaming via JSONL), so we surface it then.
        "agent_message" => {
            if !completed {
                return Vec::new();
            }
            let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if text.is_empty() {
                Vec::new()
            } else {
                vec![AiStreamEvent::Text { text: text.to_string() }]
            }
        }
        // Tool-like items: shell commands, file edits, MCP calls, web search.
        // We render them as generic ToolStart/ToolResult pairs.
        "command_execution"
        | "file_change"
        | "mcp_tool_call"
        | "web_search"
        | "plan_update" => {
            if !completed {
                let name = friendly_tool_name(item_type);
                let input = tool_input(item);
                vec![AiStreamEvent::ToolStart { id, name, input }]
            } else {
                let is_error = item
                    .get("status")
                    .and_then(|v| v.as_str())
                    .map(|s| s == "failed" || s == "error")
                    .unwrap_or(false)
                    || item
                        .get("exit_code")
                        .and_then(|v| v.as_i64())
                        .map(|c| c != 0)
                        .unwrap_or(false);
                let output = tool_output(item);
                vec![AiStreamEvent::ToolResult { id, is_error, output }]
            }
        }
        // Reasoning items are model-internal thought; skip until we choose
        // how to render them.
        "reasoning" => Vec::new(),
        _ => Vec::new(),
    }
}

fn friendly_tool_name(item_type: &str) -> String {
    match item_type {
        "command_execution" => "Bash",
        "file_change" => "FileChange",
        "mcp_tool_call" => "MCPTool",
        "web_search" => "WebSearch",
        "plan_update" => "Plan",
        other => other,
    }
    .to_string()
}

/// Pull a "request" payload out of an item for display. We pass through the
/// most relevant field per item type and fall back to the whole item.
fn tool_input(item: &serde_json::Value) -> serde_json::Value {
    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match item_type {
        "command_execution" => item
            .get("command")
            .cloned()
            .unwrap_or_else(|| item.clone()),
        "file_change" => item
            .get("changes")
            .or_else(|| item.get("path"))
            .cloned()
            .unwrap_or_else(|| item.clone()),
        "mcp_tool_call" => serde_json::json!({
            "server": item.get("server"),
            "tool": item.get("tool"),
            "arguments": item.get("arguments"),
        }),
        "web_search" => item
            .get("query")
            .cloned()
            .unwrap_or_else(|| item.clone()),
        _ => item.clone(),
    }
}

/// Pull a result payload for display. Falls back to the whole item.
fn tool_output(item: &serde_json::Value) -> serde_json::Value {
    item.get("output")
        .or_else(|| item.get("result"))
        .or_else(|| item.get("text"))
        .cloned()
        .unwrap_or_else(|| item.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_agent_message_on_completion() {
        let agent = CodexAgent;
        let line = r#"{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Hello"}}"#;
        let evs = agent.parse_line(line);
        assert_eq!(evs.len(), 1);
        match &evs[0] {
            AiStreamEvent::Text { text } => assert_eq!(text, "Hello"),
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn ignores_agent_message_on_start() {
        let agent = CodexAgent;
        let line = r#"{"type":"item.started","item":{"id":"item_3","type":"agent_message"}}"#;
        assert!(agent.parse_line(line).is_empty());
    }

    #[test]
    fn parses_command_execution_start_and_complete() {
        let agent = CodexAgent;
        let start = r#"{"type":"item.started","item":{"id":"x1","type":"command_execution","command":"ls"}}"#;
        let evs = agent.parse_line(start);
        assert_eq!(evs.len(), 1);
        match &evs[0] {
            AiStreamEvent::ToolStart { id, name, .. } => {
                assert_eq!(id, "x1");
                assert_eq!(name, "Bash");
            }
            _ => panic!("expected tool-start"),
        }

        let done = r#"{"type":"item.completed","item":{"id":"x1","type":"command_execution","exit_code":0,"output":"hi"}}"#;
        let evs = agent.parse_line(done);
        assert_eq!(evs.len(), 1);
        match &evs[0] {
            AiStreamEvent::ToolResult { id, is_error, .. } => {
                assert_eq!(id, "x1");
                assert!(!is_error);
            }
            _ => panic!("expected tool-result"),
        }
    }

    #[test]
    fn flags_failed_command_as_error() {
        let agent = CodexAgent;
        let line = r#"{"type":"item.completed","item":{"id":"x1","type":"command_execution","exit_code":1}}"#;
        let evs = agent.parse_line(line);
        match &evs[0] {
            AiStreamEvent::ToolResult { is_error, .. } => assert!(*is_error),
            _ => panic!("expected tool-result"),
        }
    }

    #[test]
    fn turn_completed_emits_done_with_usage() {
        let agent = CodexAgent;
        let line = r#"{"type":"turn.completed","usage":{"input_tokens":24763}}"#;
        let evs = agent.parse_line(line);
        assert_eq!(evs.len(), 1);
        assert!(matches!(evs[0], AiStreamEvent::Done { .. }));
    }

    #[test]
    fn turn_failed_emits_error() {
        let agent = CodexAgent;
        let line = r#"{"type":"turn.failed","error":{"message":"out of credits"}}"#;
        let evs = agent.parse_line(line);
        match &evs[0] {
            AiStreamEvent::Error { message } => assert_eq!(message, "out of credits"),
            _ => panic!("expected error"),
        }
    }

    #[test]
    fn unknown_event_yields_nothing() {
        let agent = CodexAgent;
        assert!(agent.parse_line(r#"{"type":"thread.started"}"#).is_empty());
        assert!(agent.parse_line(r#"{"type":"reasoning_step"}"#).is_empty());
        assert!(agent.parse_line("garbage").is_empty());
    }

    #[test]
    fn reasoning_item_is_skipped() {
        let agent = CodexAgent;
        let line = r#"{"type":"item.completed","item":{"id":"r1","type":"reasoning","text":"thinking…"}}"#;
        assert!(agent.parse_line(line).is_empty());
    }
}
