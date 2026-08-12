use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("io: {0}")]
    Io(String),
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("watcher: {0}")]
    Watcher(String),
    /// The single process-wide agent session is held by a different window.
    ///
    /// Structured rather than a string because the frontend acts on the payload:
    /// the AI panel offers "Focus" on `ownerLabel` and names `ownerVault` in the
    /// notice. Serializes as
    /// `{"kind":"AgentBusy","message":{"ownerLabel":…,"ownerVault":…}}` — the
    /// adjacent tag on this enum puts the struct fields under `message`.
    #[error("the AI agent is already running in another window")]
    #[serde(rename_all = "camelCase")]
    AgentBusy {
        owner_label: String,
        /// Vault the owning window has open, when it still has one. Used for a
        /// human-readable "busy in <vault>" label.
        owner_vault: Option<String>,
    },
    /// A save was refused because the file changed on disk after the window
    /// last read it (reference behavior S2.3 — VS Code's `FILE_MODIFIED_SINCE`).
    ///
    /// Structured, and its own variant rather than an `Io` string, because the
    /// frontend has to branch on it: a conflict keeps the user's buffer and
    /// offers overwrite/reload, where a generic write failure just retries.
    /// Serializes as `{"kind":"SaveConflict","message":{"path":…,
    /// "expectedDigest":…,"actualDigest":…}}`.
    #[error("the file changed on disk since it was last read")]
    #[serde(rename_all = "camelCase")]
    SaveConflict {
        path: String,
        /// Digest the window believed the file had, as handed to `write_file`.
        expected_digest: String,
        /// Digest of the bytes actually on disk when the write was attempted.
        actual_digest: String,
    },
}

pub type Result<T> = std::result::Result<T, AppError>;

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => AppError::NotFound(e.to_string()),
            _ => AppError::Io(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn io_not_found_maps_to_not_found_variant() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
        let app_err: AppError = io_err.into();
        assert!(matches!(app_err, AppError::NotFound(_)));
    }

    #[test]
    fn serializes_with_kind_and_message() {
        let err = AppError::InvalidPath("/bad".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, r#"{"kind":"InvalidPath","message":"/bad"}"#);
    }

    /// The frontend reads `ownerLabel` off this payload to offer "Focus", so the
    /// camelCase field names are part of the contract.
    #[test]
    fn agent_busy_carries_the_owning_window_in_camel_case() {
        let err = AppError::AgentBusy {
            owner_label: "win-2".into(),
            owner_vault: Some("/Users/me/vault".into()),
        };
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(
            json,
            r#"{"kind":"AgentBusy","message":{"ownerLabel":"win-2","ownerVault":"/Users/me/vault"}}"#
        );

        let vaultless = AppError::AgentBusy {
            owner_label: "win-2".into(),
            owner_vault: None,
        };
        let json = serde_json::to_string(&vaultless).unwrap();
        assert_eq!(
            json,
            r#"{"kind":"AgentBusy","message":{"ownerLabel":"win-2","ownerVault":null}}"#
        );
    }

    /// The frontend branches on `kind === "SaveConflict"` to keep the user's
    /// buffer and offer overwrite/reload instead of retrying, so the tag and
    /// the camelCase payload are part of the contract (S2.3/S2.4).
    #[test]
    fn save_conflict_is_distinguishable_from_a_generic_io_failure() {
        let err = AppError::SaveConflict {
            path: "/vault/note.md".into(),
            expected_digest: "2-aaaa".into(),
            actual_digest: "3-bbbb".into(),
        };
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(
            json,
            r#"{"kind":"SaveConflict","message":{"path":"/vault/note.md","expectedDigest":"2-aaaa","actualDigest":"3-bbbb"}}"#
        );
    }
}
