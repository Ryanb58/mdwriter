//! Embedded MCP server entry point.
//!
//! When `MDWRITER_PERM_MCP_PORT` and `MDWRITER_PERM_MCP_TOKEN` are set,
//! the mdwriter binary skips the Tauri stack and behaves as a stdio
//! JSON-RPC MCP server exposing one tool: `approve`. Each `tools/call`
//! POSTs to the parent app's loopback broker and blocks on the reply,
//! which is converted into the `{"behavior":"allow"|"deny", …}` content
//! shape Claude Code's `--permission-prompt-tool` expects.
//!
//! Per-call worker threads (Claude Code fans out parallel tool calls
//! within a single turn) share stdout through a Mutex.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub const ENV_PORT: &str = "MDWRITER_PERM_MCP_PORT";
pub const ENV_TOKEN: &str = "MDWRITER_PERM_MCP_TOKEN";

/// True if the process was launched in MCP-server mode. Checked at the
/// very top of `lib::run` so the Tauri stack is skipped entirely.
pub fn should_run() -> bool {
    std::env::var(ENV_PORT).is_ok() && std::env::var(ENV_TOKEN).is_ok()
}

/// Block reading JSON-RPC requests on stdin and writing responses on
/// stdout. Returns when stdin closes.
pub fn run() {
    let Ok(port) = std::env::var(ENV_PORT).unwrap_or_default().parse::<u16>() else {
        return;
    };
    let token = std::env::var(ENV_TOKEN).unwrap_or_default();
    if token.is_empty() { return; }

    let endpoint = format!("127.0.0.1:{port}");
    let stdout = Arc::new(Mutex::new(std::io::stdout()));
    let stdin = std::io::stdin();
    let reader = BufReader::new(stdin.lock());

    for line in reader.lines() {
        let Ok(line) = line else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }

        let req: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");

        match method {
            "initialize" => {
                if let Some(id) = id {
                    // Echo the client's protocolVersion back if it sent
                    // one. The MCP spec has changed string a few times
                    // ("2024-11-05", "2025-03-26", …); echoing what the
                    // client asked for is the most compatible move.
                    let client_version = req
                        .get("params")
                        .and_then(|p| p.get("protocolVersion"))
                        .and_then(|v| v.as_str())
                        .map(String::from)
                        .unwrap_or_else(|| "2024-11-05".into());
                    write_response(&stdout, &id, initialize_result(&client_version));
                }
            }
            "tools/list" => {
                if let Some(id) = id {
                    write_response(&stdout, &id, tools_list_result());
                }
            }
            "tools/call" => {
                let Some(id) = id else { continue };
                let params = req.get("params").cloned().unwrap_or(serde_json::Value::Null);
                let endpoint = endpoint.clone();
                let token = token.clone();
                let stdout_clone = stdout.clone();
                thread::spawn(move || {
                    let result = handle_tools_call(&endpoint, &token, &params);
                    write_response(&stdout_clone, &id, result);
                });
            }
            _ => {
                if let Some(id) = id {
                    write_error(&stdout, &id, -32601, "method not found");
                }
            }
        }
    }
}

fn initialize_result(protocol_version: &str) -> serde_json::Value {
    serde_json::json!({
        "protocolVersion": protocol_version,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "mdwriter", "version": "1" },
    })
}

fn tools_list_result() -> serde_json::Value {
    serde_json::json!({
        "tools": [
            {
                "name": "approve",
                "description": "Gate tool calls behind explicit user approval inside mdwriter.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tool_name": { "type": "string" },
                        "input": { "type": "object" },
                        "tool_use_id": { "type": "string" }
                    },
                    "required": ["tool_name", "input"]
                }
            }
        ]
    })
}

fn handle_tools_call(endpoint: &str, token: &str, params: &serde_json::Value) -> serde_json::Value {
    let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
    if name != "approve" {
        return mcp_text_content(&serde_json::json!({
            "behavior": "deny",
            "message": format!("Unknown permission tool: {name}"),
        }));
    }
    let args = params.get("arguments").cloned().unwrap_or(serde_json::Value::Null);
    let decision = round_trip(endpoint, token, &args);
    mcp_text_content(&decision)
}

/// POST the request to the broker and parse the JSON response. On any
/// transport error we **deny** with a descriptive message — never
/// silently allow a tool when the broker is unreachable. Note: read
/// timeout is intentionally absent because the user might take minutes
/// to decide; the broker tears the connection down on session end.
fn round_trip(endpoint: &str, token: &str, args: &serde_json::Value) -> serde_json::Value {
    let body = serde_json::json!({
        "tool": args.get("tool_name").cloned().unwrap_or(serde_json::Value::Null),
        "input": args.get("input").cloned().unwrap_or(serde_json::Value::Null),
        "tool_use_id": args.get("tool_use_id").cloned().unwrap_or(serde_json::Value::Null),
    });
    let body_bytes = body.to_string().into_bytes();

    let mut stream = match TcpStream::connect(endpoint) {
        Ok(s) => s,
        Err(e) => {
            return serde_json::json!({
                "behavior": "deny",
                "message": format!("permission broker unreachable: {e}"),
            });
        }
    };
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_read_timeout(None);

    let request = format!(
        "POST /permission HTTP/1.1\r\n\
         Host: {endpoint}\r\n\
         Authorization: Bearer {token}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n",
        body_bytes.len(),
    );
    if let Err(e) = stream.write_all(request.as_bytes()).and_then(|_| stream.write_all(&body_bytes)).and_then(|_| stream.flush()) {
        return serde_json::json!({
            "behavior": "deny",
            "message": format!("permission broker write failed: {e}"),
        });
    }

    let response_body = match read_http_body(&mut stream) {
        Ok(b) => b,
        Err(e) => {
            return serde_json::json!({
                "behavior": "deny",
                "message": format!("permission broker read failed: {e}"),
            });
        }
    };

    parse_decision(&response_body)
}

/// Read an HTTP/1.1 response, validate the status code, parse the body
/// using either `Content-Length` or read-to-EOF (we ask for
/// `Connection: close`, so EOF is well-defined).
fn read_http_body(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut reader = BufReader::new(stream);
    let mut status_line = String::new();
    reader.read_line(&mut status_line)?;
    let status = parse_status_code(&status_line);
    if status != Some(200) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("non-200 status: {}", status_line.trim()),
        ));
    }

    let mut content_length: Option<usize> = None;
    loop {
        let mut header = String::new();
        let n = reader.read_line(&mut header)?;
        if n == 0 || header == "\r\n" || header == "\n" { break; }
        let lower = header.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("content-length:") {
            content_length = rest.trim().parse::<usize>().ok();
        }
    }

    if let Some(len) = content_length {
        let mut buf = vec![0u8; len];
        reader.read_exact(&mut buf)?;
        Ok(String::from_utf8_lossy(&buf).into_owned())
    } else {
        let mut buf = String::new();
        reader.read_to_string(&mut buf)?;
        Ok(buf)
    }
}

/// Pull the numeric status code out of an HTTP status line like
/// `HTTP/1.1 200 OK`. Substring-match on "200" is wrong — it would
/// accept "HTTP/1.1 4200" — so parse properly.
fn parse_status_code(status_line: &str) -> Option<u16> {
    status_line.split_whitespace().nth(1)?.parse::<u16>().ok()
}

/// Convert a `{decision, message?, updated_input?}` reply from the broker
/// into the Claude-shaped `{behavior, …}` JSON. Defaults to **deny** when
/// the reply is malformed so we never accidentally allow a tool.
pub fn parse_decision(body: &str) -> serde_json::Value {
    let trimmed = body.trim();
    let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return serde_json::json!({
            "behavior": "deny",
            "message": "permission broker sent malformed reply",
        });
    };
    let decision = value.get("decision").and_then(|v| v.as_str()).unwrap_or("");
    match decision {
        "allow" => {
            let mut out = serde_json::Map::new();
            out.insert("behavior".into(), serde_json::Value::String("allow".into()));
            if let Some(updated) = value.get("updated_input").cloned() {
                out.insert("updatedInput".into(), updated);
            }
            serde_json::Value::Object(out)
        }
        _ => {
            let message = value
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Denied by user")
                .to_string();
            serde_json::json!({ "behavior": "deny", "message": message })
        }
    }
}

fn mcp_text_content(payload: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "content": [
            { "type": "text", "text": payload.to_string() }
        ]
    })
}

fn write_response(stdout: &Arc<Mutex<std::io::Stdout>>, id: &serde_json::Value, result: serde_json::Value) {
    let envelope = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    });
    let mut handle = stdout.lock().unwrap();
    let _ = writeln!(handle, "{envelope}");
    let _ = handle.flush();
}

fn write_error(stdout: &Arc<Mutex<std::io::Stdout>>, id: &serde_json::Value, code: i32, message: &str) {
    let envelope = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message },
    });
    let mut handle = stdout.lock().unwrap();
    let _ = writeln!(handle, "{envelope}");
    let _ = handle.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_decision_allow() {
        let v = parse_decision(r#"{"id":"x","decision":"allow"}"#);
        assert_eq!(v["behavior"], "allow");
        assert!(v.get("updatedInput").is_none());
    }

    #[test]
    fn parse_decision_allow_with_updated_input() {
        let v = parse_decision(r#"{"id":"x","decision":"allow","updated_input":{"a":1}}"#);
        assert_eq!(v["behavior"], "allow");
        assert_eq!(v["updatedInput"]["a"], 1);
    }

    #[test]
    fn parse_decision_deny_carries_message() {
        let v = parse_decision(r#"{"id":"x","decision":"deny","message":"no thanks"}"#);
        assert_eq!(v["behavior"], "deny");
        assert_eq!(v["message"], "no thanks");
    }

    #[test]
    fn parse_decision_deny_default_message() {
        let v = parse_decision(r#"{"id":"x","decision":"deny"}"#);
        assert_eq!(v["behavior"], "deny");
        assert_eq!(v["message"], "Denied by user");
    }

    #[test]
    fn parse_decision_malformed_defaults_deny() {
        let v = parse_decision("not json");
        assert_eq!(v["behavior"], "deny");
    }

    #[test]
    fn parse_decision_unknown_value_defaults_deny() {
        let v = parse_decision(r#"{"decision":"maybe"}"#);
        assert_eq!(v["behavior"], "deny");
    }

    #[test]
    fn initialize_advertises_tools_capability() {
        let r = initialize_result("2024-11-05");
        assert!(r["capabilities"]["tools"].is_object());
        assert_eq!(r["serverInfo"]["name"], "mdwriter");
        assert_eq!(r["protocolVersion"], "2024-11-05");
    }

    #[test]
    fn initialize_echoes_client_version() {
        let r = initialize_result("2025-03-26");
        assert_eq!(r["protocolVersion"], "2025-03-26");
    }

    #[test]
    fn parse_status_code_handles_normal_response() {
        assert_eq!(parse_status_code("HTTP/1.1 200 OK\r\n"), Some(200));
        assert_eq!(parse_status_code("HTTP/1.1 404 Not Found"), Some(404));
    }

    #[test]
    fn parse_status_code_rejects_substring_match() {
        // Old `contains("200")` would have accepted these.
        assert_eq!(parse_status_code("HTTP/1.1 4200 Weird"), Some(4200));
        assert_eq!(parse_status_code("HTTP/2.000 500 Server Error"), Some(500));
    }

    #[test]
    fn parse_status_code_returns_none_on_garbage() {
        assert_eq!(parse_status_code(""), None);
        assert_eq!(parse_status_code("HTTP/1.1 OK"), None);
    }

    #[test]
    fn tools_list_exposes_approve() {
        let r = tools_list_result();
        let tools = r["tools"].as_array().expect("tools array");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "approve");
    }
}
