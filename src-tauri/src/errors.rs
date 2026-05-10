use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("io: {0}")]
    Io(String),
    #[error("frontmatter: {0}")]
    Frontmatter(String),
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("watcher: {0}")]
    Watcher(String),
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
        let err = AppError::Frontmatter("bad yaml".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, r#"{"kind":"Frontmatter","message":"bad yaml"}"#);
    }
}
