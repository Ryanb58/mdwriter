//! Claude Code adapter.
//!
//! Spawns `claude --print --output-format stream-json --verbose <prompt>`
//! and parses the NDJSON stream that Claude Code emits.
//!
//! Output format reference (NDJSON, one JSON object per line):
//!   {"type":"system","subtype":"init","session_id":"...","tools":[...]}
//!   {"type":"assistant","message":{"id":"...","content":[{"type":"text","text":"..."},{"type":"tool_use","id":"...","name":"Read","input":{...}}]}}
//!   {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"...","content":"...","is_error":false}]}}
//!   {"type":"result","subtype":"success","duration_ms":..., "usage":{...}}

use super::{Agent, AgentCommand, AiStreamEvent};
use std::path::{Path, PathBuf};

pub struct ClaudeCodeAgent;

impl Agent for ClaudeCodeAgent {
    fn detect(&self) -> Option<PathBuf> {
        super::which("claude")
    }

    fn build_command(&self, binary: &Path, _cwd: &Path, prompt: &str) -> AgentCommand {
        AgentCommand {
            binary: binary.to_path_buf(),
            args: vec![
                "--print".into(),
                "--output-format".into(),
                "stream-json".into(),
                "--verbose".into(),
                "--permission-mode".into(),
                "acceptEdits".into(),
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
            "assistant" => parse_assistant(&value),
            "user" => parse_tool_result(&value),
            "result" => vec![AiStreamEvent::Done {
                usage: value.get("usage").cloned(),
            }],
            "system" => Vec::new(), // init events — ignore for now
            _ => Vec::new(),
        }
    }
}

fn parse_assistant(value: &serde_json::Value) -> Vec<AiStreamEvent> {
    let mut events: Vec<AiStreamEvent> = Vec::new();
    let Some(content) = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    else {
        return events;
    };

    for block in content {
        let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match block_type {
            "text" => {
                if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                    if !text.is_empty() {
                        events.push(AiStreamEvent::Text { text: text.to_string() });
                    }
                }
            }
            "tool_use" => {
                let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let input = block.get("input").cloned().unwrap_or(serde_json::Value::Null);
                events.push(AiStreamEvent::ToolStart { id, name, input });
            }
            _ => {}
        }
    }

    events
}

fn parse_tool_result(value: &serde_json::Value) -> Vec<AiStreamEvent> {
    let mut events: Vec<AiStreamEvent> = Vec::new();
    let Some(content) = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    else {
        return events;
    };

    for block in content {
        if block.get("type").and_then(|v| v.as_str()) != Some("tool_result") {
            continue;
        }
        let id = block.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let is_error = block.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
        let output = block.get("content").cloned().unwrap_or(serde_json::Value::Null);
        events.push(AiStreamEvent::ToolResult { id, is_error, output });
    }

    events
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_assistant_text_block() {
        let agent = ClaudeCodeAgent;
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}"#;
        let evs = agent.parse_line(line);
        assert_eq!(evs.len(), 1);
        match &evs[0] {
            AiStreamEvent::Text { text } => assert_eq!(text, "Hello"),
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn parses_tool_use_block() {
        let agent = ClaudeCodeAgent;
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{"path":"a.md"}}]}}"#;
        let evs = agent.parse_line(line);
        assert_eq!(evs.len(), 1);
        match &evs[0] {
            AiStreamEvent::ToolStart { id, name, .. } => {
                assert_eq!(id, "t1");
                assert_eq!(name, "Read");
            }
            _ => panic!("expected tool start"),
        }
    }

    #[test]
    fn parses_done_on_result() {
        let agent = ClaudeCodeAgent;
        let line = r#"{"type":"result","subtype":"success","usage":{"input_tokens":100}}"#;
        let evs = agent.parse_line(line);
        assert_eq!(evs.len(), 1);
        assert!(matches!(evs[0], AiStreamEvent::Done { .. }));
    }

    #[test]
    fn unknown_lines_yield_no_events() {
        let agent = ClaudeCodeAgent;
        assert!(agent.parse_line("not json").is_empty());
        assert!(agent.parse_line(r#"{"type":"system","subtype":"init"}"#).is_empty());
    }
}
