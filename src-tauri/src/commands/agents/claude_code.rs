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

use super::{Agent, AgentCommand, AiStreamEvent, PermissionMode};
use std::path::{Path, PathBuf};

pub struct ClaudeCodeAgent;

impl Agent for ClaudeCodeAgent {
    fn detect(&self) -> Option<PathBuf> {
        super::which("claude")
    }

    fn build_command(
        &self,
        binary: &Path,
        _cwd: &Path,
        prompt: &str,
        permission_mode: PermissionMode,
    ) -> AgentCommand {
        let mut args: Vec<String> = vec![
            "--print".into(),
            "--output-format".into(),
            "stream-json".into(),
            "--verbose".into(),
            "--permission-mode".into(),
            permission_mode.as_flag().into(),
        ];

        // Pre-authorize the user-level skill directories so the agent can
        // read SKILL.md files referenced from the command palette without
        // prompting on every invocation. cwd is implicitly allowed, so
        // vault-level skill dirs need no flag.
        //
        // `--add-dir` is variadic in Claude Code's commander.js parser — one
        // flag, all dirs, then a `--` separator so the prompt isn't eaten
        // as another directory.
        let dirs = skill_add_dirs();
        if !dirs.is_empty() {
            args.push("--add-dir".into());
            args.extend(dirs);
        }
        args.push("--".into());
        args.push(prompt.to_string());

        AgentCommand {
            binary: binary.to_path_buf(),
            args,
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

/// Skill directories outside the vault cwd that the agent should be able to
/// read without a permission prompt. We list `~/.claude` and `~/.agents`
/// rather than the nested `skills/` subdirs because Claude Code follows
/// symlinks — many users link `~/.claude/skills/<x>` to a repo elsewhere,
/// and the assets a skill references may live alongside `SKILL.md`. Only
/// existing directories are returned.
fn skill_add_dirs() -> Vec<String> {
    let mut out = Vec::new();
    if let Some(home) = dirs::home_dir() {
        for sub in [".claude", ".agents"] {
            let p = home.join(sub);
            if p.is_dir() {
                out.push(p.to_string_lossy().into_owned());
            }
        }
    }
    out
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

    #[test]
    fn build_command_pre_authorizes_user_skill_dirs() {
        let agent = ClaudeCodeAgent;
        let cmd = agent.build_command(
            Path::new("claude"),
            Path::new("/vault"),
            "hi",
            PermissionMode::AcceptEdits,
        );
        // Prompt sits at the very end as the positional arg.
        assert_eq!(cmd.args.last().unwrap(), "hi");
        // `--` terminator separates options from prompt so the variadic
        // `--add-dir` flag doesn't eat the prompt as another directory.
        let dd_pos = cmd.args.iter().rposition(|a| a == "--");
        let prompt_pos = cmd.args.iter().rposition(|a| a == "hi");
        assert!(dd_pos.is_some() && prompt_pos.is_some());
        assert!(dd_pos.unwrap() < prompt_pos.unwrap());

        if let Some(home) = dirs::home_dir() {
            for sub in [".claude", ".agents"] {
                let p = home.join(sub);
                if p.is_dir() {
                    let needle = p.to_string_lossy().into_owned();
                    assert!(
                        cmd.args.iter().any(|a| a == &needle),
                        "expected {needle} in args {:?}",
                        cmd.args,
                    );
                }
            }
        }
    }

    #[test]
    fn build_command_respects_permission_mode() {
        let agent = ClaudeCodeAgent;
        for (mode, flag) in [
            (PermissionMode::AcceptEdits, "acceptEdits"),
            (PermissionMode::Plan, "plan"),
            (PermissionMode::BypassPermissions, "bypassPermissions"),
        ] {
            let cmd = agent.build_command(Path::new("claude"), Path::new("/v"), "x", mode);
            let pm_idx = cmd.args.iter().position(|a| a == "--permission-mode").unwrap();
            assert_eq!(cmd.args[pm_idx + 1], flag);
        }
    }
}
