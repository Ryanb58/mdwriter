//! Claude Code permission broker.
//!
//! Owns one HTTP loopback server per AI session bound to 127.0.0.1 on a
//! random port. Authenticates each incoming request with a bearer token
//! generated at session start and passed to the embedded MCP server via
//! env vars. Each POST /permission represents one in-flight tool call:
//! the handler thread emits an `ai-permission` event to the frontend,
//! parks on a oneshot until `respond_permission` fires, then writes the
//! decision back as the HTTP response.
//!
//! Session allowlist: when the user picks "Allow for session" the
//! frontend extends an in-memory `(tool, path-prefix)` allowlist on the
//! broker. Subsequent requests that match are short-circuited inside
//! the handler — no event, no UI, just an immediate allow. This pairs
//! with `--allowed-tools` set at session start (Read / Grep / Glob / LS)
//! so the broker only sees the *interesting* tool calls in the first
//! place.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server};

/// Hard cap on request body size. Tool inputs are tiny (file paths,
/// commands, edit strings) — a request larger than this is either a
/// bug on the MCP-server side or someone probing the loopback. Reject
/// with 413 instead of growing the broker's memory.
const MAX_BODY_BYTES: u64 = 256 * 1024;

use super::{Decision, PermissionBroker};
use crate::commands::agents::AgentCommand;

/// Wire-format request that the MCP server POSTs to /permission.
#[derive(Debug, Clone, Deserialize)]
pub struct WireRequest {
    pub tool: String,
    #[serde(default)]
    pub input: serde_json::Value,
    #[serde(default)]
    pub tool_use_id: Option<String>,
}

/// Event emitted to the frontend on `ai-permission`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionEvent {
    pub id: String,
    pub tool: String,
    pub input: serde_json::Value,
    pub tool_use_id: Option<String>,
}

/// Session-scoped allow rule. "Tool X on any path under prefix" — or any
/// path if `path_prefix` is None.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllowRule {
    pub tool: String,
    #[serde(default)]
    pub path_prefix: Option<String>,
}

type PendingMap = Arc<Mutex<HashMap<String, Sender<Decision>>>>;
type Allowlist = Arc<Mutex<Vec<AllowRule>>>;

pub struct ClaudeCodeMcpBroker {
    port: u16,
    token: String,
    /// Window label that owns this session. Approval events are addressed here
    /// with `emit_to` rather than broadcast: an approval card is a request to
    /// authorize a write inside *this* window's vault, so it must not appear in
    /// (or be answerable from) any other window.
    owner_label: String,
    /// Directory holding the generated mcp-config.json. Removed on drop.
    tmp_dir: PathBuf,
    mcp_config_path: PathBuf,
    /// Held so the trait object owns the shared state; the acceptor
    /// thread holds clones of these.
    pending: PendingMap,
    allowlist: Allowlist,
    shutdown_flag: Arc<Mutex<bool>>,
}

impl ClaudeCodeMcpBroker {
    /// Bind a fresh loopback port, generate a token, write the
    /// `--mcp-config` file, and spawn the acceptor thread. The returned
    /// broker is ready to be wired into an [`AgentCommand`].
    pub fn spawn<R: tauri::Runtime>(
        app: AppHandle<R>,
        exe_path: PathBuf,
        owner_label: String,
    ) -> std::io::Result<Self> {
        // tiny_http binds for us — pass port 0 to ask the OS for one and
        // ask the listener for its address back.
        let server = Server::http("127.0.0.1:0").map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::Other, format!("http bind: {e}"))
        })?;
        let addr = server.server_addr();
        let port = addr.to_ip().map(|ip| ip.port()).unwrap_or(0);
        if port == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "could not resolve bound port",
            ));
        }

        let token = generate_token();

        let tmp_dir = tempfile::Builder::new()
            .prefix("mdwriter-perm-")
            .tempdir()?
            .keep();
        let mcp_config_path = tmp_dir.join("mcp-config.json");
        let cfg = mcp_config_json(&exe_path, port, &token);
        std::fs::write(&mcp_config_path, serde_json::to_vec_pretty(&cfg)?)?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let allowlist: Allowlist = Arc::new(Mutex::new(Vec::new()));
        let shutdown_flag = Arc::new(Mutex::new(false));

        let app_for_thread = app.clone();
        let pending_for_thread = pending.clone();
        let allowlist_for_thread = allowlist.clone();
        let shutdown_for_thread = shutdown_flag.clone();
        let token_for_thread = token.clone();
        let owner_for_thread = owner_label.clone();
        thread::spawn(move || {
            run_acceptor(
                server,
                app_for_thread,
                pending_for_thread,
                allowlist_for_thread,
                shutdown_for_thread,
                token_for_thread,
                owner_for_thread,
            );
        });

        Ok(Self {
            port,
            token,
            owner_label,
            tmp_dir,
            mcp_config_path,
            pending,
            allowlist,
            shutdown_flag,
        })
    }

}

impl PermissionBroker for ClaudeCodeMcpBroker {
    fn wire(&self, cmd: &mut AgentCommand) {
        // CRITICAL: `build_command` terminates the arg list with `--` (so
        // the variadic `--add-dir` doesn't swallow the prompt) and the
        // positional prompt string. Any flags pushed plain `cmd.args.push`
        // would land AFTER `--` and be parsed as part of the prompt by
        // commander.js — meaning the MCP server is silently never
        // registered. Insert the broker's flags BEFORE the `--` so they
        // reach Claude Code's flag parser.
        let extras = [
            "--permission-prompt-tool".to_string(),
            "mcp__mdwriter__approve".to_string(),
            "--mcp-config".to_string(),
            self.mcp_config_path.to_string_lossy().into_owned(),
        ];
        insert_before_terminator(&mut cmd.args, &extras);

        // The MCP server inherits its env from Claude Code (its parent),
        // and Claude Code inherits its env from us — so token + port
        // make it through transparently.
        cmd.env.push((
            super::embedded_mcp::ENV_PORT.into(),
            self.port.to_string(),
        ));
        cmd.env.push((
            super::embedded_mcp::ENV_TOKEN.into(),
            self.token.clone(),
        ));
    }

    fn respond(&self, decision: Decision) -> bool {
        let sender = self.pending.lock().unwrap().remove(&decision.id);
        match sender {
            Some(tx) => tx.send(decision).is_ok(),
            None => false,
        }
    }

    fn shutdown(&self) {
        log::debug!("permission broker for window {} shutting down", self.owner_label);
        *self.shutdown_flag.lock().unwrap() = true;
        let drained: Vec<(String, Sender<Decision>)> =
            self.pending.lock().unwrap().drain().collect();
        for (id, tx) in drained {
            let _ = tx.send(Decision::deny(id, "Session ended before approval"));
        }
    }

    fn add_allow_rule(&self, tool: &str, path_prefix: Option<&str>) -> bool {
        self.allowlist.lock().unwrap().push(AllowRule {
            tool: tool.to_string(),
            path_prefix: path_prefix.map(String::from),
        });
        true
    }
}

impl Drop for ClaudeCodeMcpBroker {
    fn drop(&mut self) {
        self.shutdown();
        let _ = std::fs::remove_dir_all(&self.tmp_dir);
    }
}

fn run_acceptor<R: tauri::Runtime>(
    server: Server,
    app: AppHandle<R>,
    pending: PendingMap,
    allowlist: Allowlist,
    shutdown_flag: Arc<Mutex<bool>>,
    token: String,
    owner_label: String,
) {
    // recv_timeout lets us poll the shutdown flag without a separate
    // wakeup channel. 50ms is fast enough that shutdown feels instant.
    loop {
        if *shutdown_flag.lock().unwrap() { break; }
        let request = match server.recv_timeout(Duration::from_millis(50)) {
            Ok(Some(r)) => r,
            Ok(None) => continue,
            Err(_) => break,
        };
        let app = app.clone();
        let pending = pending.clone();
        let allowlist = allowlist.clone();
        let token = token.clone();
        let owner_label = owner_label.clone();
        thread::spawn(move || {
            handle_request(request, app, pending, allowlist, token, owner_label);
        });
    }
}

fn handle_request<R: tauri::Runtime>(
    mut request: tiny_http::Request,
    app: AppHandle<R>,
    pending: PendingMap,
    allowlist: Allowlist,
    token: String,
    owner_label: String,
) {
    // Route + method check first so we can fast-reject bad probes
    // before we touch the body.
    if request.method() != &Method::Post || request.url() != "/permission" {
        let _ = request.respond(Response::from_string("not found").with_status_code(404));
        return;
    }

    // Bearer-token auth. tiny_http exposes headers as a slice.
    let authorized = request.headers().iter().any(|h| {
        h.field.equiv("Authorization")
            && h.value.as_str().trim_start_matches("Bearer ").trim() == token
    });
    if !authorized {
        let _ = request.respond(Response::from_string("unauthorized").with_status_code(401));
        return;
    }

    let mut body = String::new();
    if request.as_reader().take(MAX_BODY_BYTES).read_to_string(&mut body).is_err() {
        let _ = request.respond(Response::from_string("bad body").with_status_code(400));
        return;
    }
    // `take` silently truncates if the body is larger; a truncated JSON
    // payload will fail `serde_json::from_str` below, so the 400 path
    // covers it. We don't 413 explicitly because tiny_http doesn't
    // expose Content-Length without reading first anyway.

    let wire: WireRequest = match serde_json::from_str(&body) {
        Ok(w) => w,
        Err(_) => {
            let _ = request.respond(Response::from_string("invalid json").with_status_code(400));
            return;
        }
    };

    // Session allowlist short-circuit: never bother the user for things
    // they've already blanket-allowed.
    if matches_any(&allowlist.lock().unwrap(), &wire) {
        let decision = Decision::allow(""); // id unused by MCP server side
        let _ = request.respond(json_response(&decision));
        return;
    }

    let id = generate_request_id();
    let (tx, rx) = mpsc::channel::<Decision>();
    pending.lock().unwrap().insert(id.clone(), tx);

    let event = PermissionEvent {
        id: id.clone(),
        tool: wire.tool.clone(),
        input: wire.input.clone(),
        tool_use_id: wire.tool_use_id.clone(),
    };
    emit_permission_request(&app, &owner_label, &event);

    // Wait — possibly for minutes — for the UI to respond. Shutdown
    // drains the sender, so this will unblock cleanly on session end.
    let decision = match rx.recv() {
        Ok(d) => d,
        Err(_) => Decision::deny(id.clone(), "Permission broker channel closed"),
    };
    // Belt-and-braces: shutdown drains via remove already, but harmless.
    pending.lock().unwrap().remove(&id);

    let _ = request.respond(json_response(&decision));
}

/// Address an approval request at the session's owning window.
///
/// A broadcast `emit` puts the card in every open window, and since
/// `respond_permission` resolves by opaque id against the one process-global
/// broker, whichever window answers first authorizes a tool call inside the
/// *owner's* vault. `emit_to` is half the fix; the receiving side has to
/// register against its own label too (`listenForThisWindow`).
pub(crate) fn emit_permission_request<R: tauri::Runtime>(
    app: &AppHandle<R>,
    owner_label: &str,
    event: &PermissionEvent,
) {
    let _ = app.emit_to(owner_label, "ai-permission", event);
}

fn json_response(decision: &Decision) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(decision).unwrap_or_else(|_| b"{}".to_vec());
    Response::from_data(body)
        .with_status_code(200)
        .with_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap())
}

fn matches_any(rules: &[AllowRule], req: &WireRequest) -> bool {
    rules.iter().any(|r| matches_rule(r, req))
}

fn matches_rule(rule: &AllowRule, req: &WireRequest) -> bool {
    if !tool_matches(&rule.tool, &req.tool) { return false; }
    let Some(prefix) = &rule.path_prefix else { return true; };
    // Apply prefix matching to the conventional path-shaped input fields.
    if let Some(path) = req.input.get("file_path").and_then(|v| v.as_str()) {
        return path.starts_with(prefix);
    }
    if let Some(path) = req.input.get("path").and_then(|v| v.as_str()) {
        return path.starts_with(prefix);
    }
    false
}

fn tool_matches(rule_tool: &str, req_tool: &str) -> bool {
    if rule_tool == "*" { return true; }
    rule_tool.eq_ignore_ascii_case(req_tool)
}

/// Insert `extras` immediately before the first `--` separator in `args`.
/// Falls back to appending if there's no `--` (e.g. an adapter that
/// builds args without a positional-terminator). Pulled out so we can
/// unit-test the ordering logic — broken flag placement is a silent
/// failure mode (the MCP server gets registered as part of the prompt
/// and never runs).
fn insert_before_terminator(args: &mut Vec<String>, extras: &[String]) {
    let pos = args.iter().position(|a| a == "--");
    match pos {
        Some(i) => {
            for (n, s) in extras.iter().enumerate() {
                args.insert(i + n, s.clone());
            }
        }
        None => args.extend_from_slice(extras),
    }
}

/// Build the JSON written to the `--mcp-config` file. One server, named
/// `mdwriter` (so the tool surfaces as `mcp__mdwriter__approve`).
pub fn mcp_config_json(exe_path: &Path, port: u16, token: &str) -> serde_json::Value {
    serde_json::json!({
        "mcpServers": {
            "mdwriter": {
                "command": exe_path.to_string_lossy(),
                "args": [],
                "env": {
                    super::embedded_mcp::ENV_PORT: port.to_string(),
                    super::embedded_mcp::ENV_TOKEN: token,
                }
            }
        }
    })
}

/// 128-bit bearer token, hex-encoded to 32 chars. Sourced from the OS
/// CSPRNG via `getrandom` — this token gates an HTTP endpoint that can
/// authorize arbitrary tool calls (Edit/Write/Bash) inside the user's
/// vault, so predictable token material would be a local-privilege
/// escalation surface for any other process on the same machine.
fn generate_token() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("system RNG unavailable");
    let mut out = String::with_capacity(32);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn generate_request_id() -> String {
    format!(
        "req-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(tool: &str, path: Option<&str>) -> WireRequest {
        let input = match path {
            Some(p) => serde_json::json!({ "file_path": p }),
            None => serde_json::json!({}),
        };
        WireRequest { tool: tool.into(), input, tool_use_id: None }
    }

    #[test]
    fn rule_with_no_prefix_matches_any_input() {
        let r = AllowRule { tool: "Bash".into(), path_prefix: None };
        assert!(matches_rule(&r, &req("Bash", None)));
        assert!(matches_rule(&r, &req("Bash", Some("/x/y"))));
        assert!(!matches_rule(&r, &req("Read", None)));
    }

    #[test]
    fn rule_with_prefix_matches_path_inputs() {
        let r = AllowRule {
            tool: "Read".into(),
            path_prefix: Some("/Users/me/vault/".into()),
        };
        assert!(matches_rule(&r, &req("Read", Some("/Users/me/vault/note.md"))));
        assert!(!matches_rule(&r, &req("Read", Some("/etc/passwd"))));
        // No path-shaped field at all -> no match (don't blanket-allow).
        assert!(!matches_rule(&r, &req("Read", None)));
    }

    #[test]
    fn star_tool_matches_anything() {
        let r = AllowRule { tool: "*".into(), path_prefix: None };
        assert!(matches_rule(&r, &req("Bash", None)));
        assert!(matches_rule(&r, &req("Read", Some("/x"))));
    }

    #[test]
    fn tool_match_is_case_insensitive() {
        let r = AllowRule { tool: "bash".into(), path_prefix: None };
        assert!(matches_rule(&r, &req("Bash", None)));
    }

    #[test]
    fn insert_before_terminator_splices_in_front_of_dashdash() {
        let mut args: Vec<String> = vec!["--print", "--add-dir", "/x", "--", "prompt"]
            .into_iter().map(String::from).collect();
        let extras: Vec<String> = vec!["--permission-prompt-tool", "name", "--mcp-config", "/c"]
            .into_iter().map(String::from).collect();
        insert_before_terminator(&mut args, &extras);
        assert_eq!(
            args,
            vec![
                "--print", "--add-dir", "/x",
                "--permission-prompt-tool", "name", "--mcp-config", "/c",
                "--", "prompt",
            ],
        );
    }

    #[test]
    fn insert_before_terminator_appends_when_no_dashdash() {
        let mut args: Vec<String> = vec!["--print"].into_iter().map(String::from).collect();
        let extras: Vec<String> = vec!["--flag", "value"].into_iter().map(String::from).collect();
        insert_before_terminator(&mut args, &extras);
        assert_eq!(args, vec!["--print", "--flag", "value"]);
    }

    #[test]
    fn mcp_config_points_at_exe_and_uses_envs() {
        let cfg = mcp_config_json(Path::new("/bin/mdwriter"), 12345, "tok");
        let srv = &cfg["mcpServers"]["mdwriter"];
        assert_eq!(srv["command"], "/bin/mdwriter");
        assert_eq!(srv["env"][super::super::embedded_mcp::ENV_PORT], "12345");
        assert_eq!(srv["env"][super::super::embedded_mcp::ENV_TOKEN], "tok");
    }

    #[test]
    fn generated_tokens_are_32_hex_chars() {
        // Guards against accidentally returning a short/empty/non-hex
        // token — the security boundary in `handle_request` checks for
        // an exact match, so format drift would silently break auth.
        let t = generate_token();
        assert_eq!(t.len(), 32);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()), "token contained non-hex chars: {t}");
    }

    /// The owner label has to survive `spawn` — the acceptor thread it starts is
    /// what addresses every `ai-permission` event, and a broker that lost the
    /// label would have nothing to address them to.
    #[test]
    fn a_spawned_broker_remembers_which_window_owns_it() {
        let app = tauri::test::mock_app();
        let broker = ClaudeCodeMcpBroker::spawn(
            app.handle().clone(),
            // Never executed: nothing runs the MCP server in this test.
            PathBuf::from("/nonexistent/mdwriter"),
            "w-second".to_string(),
        )
        .expect("the broker binds a loopback port");

        assert_eq!(broker.owner_label, "w-second");
        // Stop the acceptor thread before the test ends; `Drop` also removes the
        // generated mcp-config directory.
        broker.shutdown();
    }

    /// Allowlist short-circuit: when a rule matches, the broker resolves
    /// the request immediately without parking on a oneshot. We can't
    /// test the event-emission absence without a Tauri AppHandle, but
    /// we can test that the match function is the only gate.
    #[test]
    fn allowlist_short_circuit_matches_before_event() {
        let allowlist = vec![AllowRule { tool: "Read".into(), path_prefix: Some("/vault/".into()) }];
        let inside = WireRequest { tool: "Read".into(), input: serde_json::json!({"file_path":"/vault/a.md"}), tool_use_id: None };
        let outside = WireRequest { tool: "Read".into(), input: serde_json::json!({"file_path":"/etc/passwd"}), tool_use_id: None };
        assert!(matches_any(&allowlist, &inside));
        assert!(!matches_any(&allowlist, &outside));
    }
}
