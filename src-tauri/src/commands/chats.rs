//! Per-vault chat persistence.
//!
//! Chats live at `<vault>/.mdwriter/chats/<id>.json`. The frontend owns the
//! shape — we just round-trip opaque JSON. This keeps the wire contract narrow
//! and lets the TS type evolve without a Rust rebuild.
//!
//! The list endpoint sorts newest-first by `updated_at` so a typical UI ("most
//! recent at the top") doesn't have to re-sort.

use crate::errors::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const CHATS_SUBDIR: &str = ".mdwriter/chats";

fn chats_dir(vault: &Path) -> PathBuf {
    vault.join(CHATS_SUBDIR)
}

fn chat_path(vault: &Path, id: &str) -> Result<PathBuf> {
    // Defence in depth: chat IDs come from the frontend, and we drop anything
    // path-like (separators, ".."). Without this a hostile chat ID could
    // escape the chats dir.
    if id.is_empty()
        || id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || id.contains('\0')
    {
        return Err(AppError::InvalidPath(format!("chat id: {id}")));
    }
    Ok(chats_dir(vault).join(format!("{id}.json")))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatSummary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    pub created_at: i64,
}

/// JSON envelope written to disk. The `data` field is the frontend's `Chat`
/// object verbatim — we don't model it on the Rust side.
#[derive(Debug, Serialize, Deserialize)]
struct ChatFile {
    id: String,
    title: String,
    #[serde(default)]
    created_at: i64,
    #[serde(default)]
    updated_at: i64,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[tauri::command]
pub fn list_chats(vault_path: String) -> Result<Vec<ChatSummary>> {
    let root = chats_dir(Path::new(&vault_path));
    let mut summaries: Vec<ChatSummary> = Vec::new();
    let read = match std::fs::read_dir(&root) {
        Ok(it) => it,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(summaries),
        Err(e) => return Err(e.into()),
    };
    for entry in read.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&p) else { continue };
        let Ok(parsed) = serde_json::from_str::<ChatFile>(&text) else { continue };
        summaries.push(ChatSummary {
            id: parsed.id,
            title: parsed.title,
            updated_at: parsed.updated_at,
            created_at: parsed.created_at,
        });
    }
    summaries.sort_by_key(|s| -s.updated_at);
    Ok(summaries)
}

#[tauri::command]
pub fn read_chat(vault_path: String, id: String) -> Result<serde_json::Value> {
    let path = chat_path(Path::new(&vault_path), &id)?;
    let text = std::fs::read_to_string(&path)?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(value)
}

#[tauri::command]
pub fn write_chat(vault_path: String, id: String, data: serde_json::Value) -> Result<()> {
    let dir = chats_dir(Path::new(&vault_path));
    std::fs::create_dir_all(&dir)?;
    let path = chat_path(Path::new(&vault_path), &id)?;
    // Atomic write: temp file → persist. Same approach as the doc save path
    // in fs.rs — avoids leaving a half-written chat on a crash.
    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&data).map_err(|e| AppError::Io(e.to_string()))?;
    std::fs::write(&tmp_path, json)?;
    std::fs::rename(&tmp_path, &path)?;
    Ok(())
}

#[tauri::command]
pub fn delete_chat(vault_path: String, id: String) -> Result<()> {
    let path = chat_path(Path::new(&vault_path), &id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn rejects_traversal_in_id() {
        let tmp = tempdir().unwrap();
        let result = chat_path(tmp.path(), "../escape");
        assert!(result.is_err());
    }

    #[test]
    fn write_then_read_round_trips() {
        let tmp = tempdir().unwrap();
        let vault = tmp.path().to_string_lossy().to_string();
        let data = serde_json::json!({
            "id": "abc",
            "title": "hello",
            "created_at": 1,
            "updated_at": 2,
            "messages": ["m1"],
        });
        write_chat(vault.clone(), "abc".into(), data.clone()).unwrap();
        let read_back = read_chat(vault, "abc".into()).unwrap();
        assert_eq!(read_back, data);
    }

    #[test]
    fn list_returns_empty_when_dir_missing() {
        let tmp = tempdir().unwrap();
        let list = list_chats(tmp.path().to_string_lossy().to_string()).unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn list_sorts_newest_first() {
        let tmp = tempdir().unwrap();
        let vault = tmp.path().to_string_lossy().to_string();
        write_chat(
            vault.clone(),
            "older".into(),
            serde_json::json!({ "id": "older", "title": "Older", "updated_at": 100, "created_at": 1 }),
        )
        .unwrap();
        write_chat(
            vault.clone(),
            "newer".into(),
            serde_json::json!({ "id": "newer", "title": "Newer", "updated_at": 500, "created_at": 2 }),
        )
        .unwrap();
        let list = list_chats(vault).unwrap();
        assert_eq!(list[0].id, "newer");
        assert_eq!(list[1].id, "older");
    }

    #[test]
    fn delete_is_idempotent() {
        let tmp = tempdir().unwrap();
        let vault = tmp.path().to_string_lossy().to_string();
        delete_chat(vault.clone(), "nope".into()).unwrap();
        // Second call must also succeed.
        delete_chat(vault, "nope".into()).unwrap();
    }
}
