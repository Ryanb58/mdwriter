//! Per-vault chat persistence.
//!
//! Chats live at `<vault>/.mdwriter/chats/<id>.json`. The frontend owns the
//! shape — we just round-trip opaque JSON. This keeps the wire contract narrow
//! and lets the TS type evolve without a Rust rebuild.
//!
//! The list endpoint sorts newest-first by `updatedAt` so a typical UI ("most
//! recent at the top") doesn't have to re-sort. The chat's id is always the
//! filename stem — the on-disk `id` field is treated as untrusted metadata.

use crate::errors::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::io::Write;
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
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

/// On-disk shape we care about for listing. The frontend stores chats with
/// camelCase keys (matching the TS `Chat` type), so we rename to match; the
/// snake_case alias is kept so older test fixtures and any future migration
/// path still parse.
#[derive(Debug, Deserialize)]
struct ChatFile {
    #[serde(default)]
    title: String,
    #[serde(default, rename = "createdAt", alias = "created_at")]
    created_at: i64,
    #[serde(default, rename = "updatedAt", alias = "updated_at")]
    updated_at: i64,
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
        // Always derive the id from the filename — that's the same string
        // `read_chat` and `delete_chat` accept, so a mismatched JSON `id`
        // can't strand the chat from later operations.
        let Some(id) = p.file_stem().and_then(|s| s.to_str()).map(str::to_string) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(&p) else { continue };
        let Ok(parsed) = serde_json::from_str::<ChatFile>(&text) else { continue };
        summaries.push(ChatSummary {
            id,
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
    write_json_atomic(&path, &data)
}

/// Atomic write that overwrites the destination — matches the pattern in
/// `commands/fs.rs::write_bytes_atomic_clobber`. `tempfile`'s `persist`
/// handles the cross-platform clobber semantics (POSIX rename swaps; Windows
/// uses `ReplaceFile`-equivalent), so this works on every supported OS.
fn write_json_atomic(path: &Path, data: &serde_json::Value) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidPath(path.display().to_string()))?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| AppError::Io(format!("tempfile: {e}")))?;
    let json = serde_json::to_string_pretty(data).map_err(|e| AppError::Io(e.to_string()))?;
    tmp.write_all(json.as_bytes())?;
    tmp.as_file().sync_all()?;
    tmp.persist(path)
        .map_err(|e| AppError::Io(format!("persist: {}", e.error)))?;
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
        // Use the on-disk camelCase shape produced by the frontend.
        let data = serde_json::json!({
            "id": "abc",
            "title": "hello",
            "createdAt": 1,
            "updatedAt": 2,
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
            serde_json::json!({ "id": "older", "title": "Older", "updatedAt": 100, "createdAt": 1 }),
        )
        .unwrap();
        write_chat(
            vault.clone(),
            "newer".into(),
            serde_json::json!({ "id": "newer", "title": "Newer", "updatedAt": 500, "createdAt": 2 }),
        )
        .unwrap();
        let list = list_chats(vault).unwrap();
        assert_eq!(list[0].id, "newer");
        assert_eq!(list[1].id, "older");
    }

    #[test]
    fn list_uses_filename_for_id_when_json_mismatches() {
        let tmp = tempdir().unwrap();
        let vault = tmp.path().to_string_lossy().to_string();
        // JSON id deliberately disagrees with the filename — we trust the
        // filename so callers' subsequent read/delete calls still work.
        write_chat(
            vault.clone(),
            "correct-id".into(),
            serde_json::json!({ "id": "different-id", "title": "X", "updatedAt": 1, "createdAt": 0 }),
        )
        .unwrap();
        let list = list_chats(vault).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "correct-id");
    }

    #[test]
    fn list_accepts_legacy_snake_case_timestamps() {
        let tmp = tempdir().unwrap();
        let vault = tmp.path().to_string_lossy().to_string();
        write_chat(
            vault.clone(),
            "legacy".into(),
            serde_json::json!({ "id": "legacy", "title": "L", "updated_at": 42, "created_at": 1 }),
        )
        .unwrap();
        let list = list_chats(vault).unwrap();
        assert_eq!(list[0].updated_at, 42);
    }

    #[test]
    fn write_overwrites_existing_file() {
        // The Windows rename-fails-when-exists hazard, demonstrated to the
        // best of our ability on POSIX too: two writes to the same id must
        // both succeed and leave the second value on disk.
        let tmp = tempdir().unwrap();
        let vault = tmp.path().to_string_lossy().to_string();
        write_chat(vault.clone(), "x".into(), serde_json::json!({ "id": "x", "title": "first" }))
            .unwrap();
        write_chat(vault.clone(), "x".into(), serde_json::json!({ "id": "x", "title": "second" }))
            .unwrap();
        let value = read_chat(vault, "x".into()).unwrap();
        assert_eq!(value.get("title").and_then(|v| v.as_str()), Some("second"));
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
