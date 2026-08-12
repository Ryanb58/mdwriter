use crate::commands::fs::TreeOptions;
use crate::errors::Result;
use crate::state::AppState;
use ignore::WalkBuilder;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Serialize, Debug)]
pub struct VaultNoteRecord {
    pub name: String,
    pub path: PathBuf,
    pub rel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtime: Option<i64>,
}

#[tauri::command]
pub fn list_markdown_notes<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    root: PathBuf,
    options: Option<TreeOptions>,
) -> Result<Vec<VaultNoteRecord>> {
    list_markdown_notes_scoped(
        state.inner(),
        window.label(),
        root,
        options.unwrap_or_default(),
    )
}

fn list_markdown_notes_scoped(
    state: &AppState,
    label: &str,
    root: PathBuf,
    options: TreeOptions,
) -> Result<Vec<VaultNoteRecord>> {
    // Validated against the *calling window's* vault, so window B can't list
    // window A's vault by passing A's root.
    let canonical = state
        .get_or_create(label)
        .ensure_within_active_vault(&root)?;
    list_markdown_notes_impl(canonical, options)
}

fn list_markdown_notes_impl(
    root: PathBuf,
    options: TreeOptions,
) -> Result<Vec<VaultNoteRecord>> {
    let mut walker = WalkBuilder::new(&root);
    walker
        .standard_filters(false)
        .hidden(true)
        .git_ignore(options.hide_gitignored)
        .git_global(options.hide_gitignored)
        .git_exclude(options.hide_gitignored)
        .parents(options.hide_gitignored)
        .require_git(false);

    let mut notes = Vec::new();
    for entry in walker.build().filter_map(std::result::Result::ok) {
        if !entry.file_type().map(|kind| kind.is_file()).unwrap_or(false)
            || !is_markdown(entry.path())
        {
            continue;
        }

        let path = entry.path().to_path_buf();
        let rel = path
            .strip_prefix(&root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let name = path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();
        notes.push(VaultNoteRecord {
            name,
            mtime: file_mtime_secs(&path),
            path,
            rel,
        });
    }

    notes.sort_by(|left, right| left.rel.cmp(&right.rel));
    Ok(notes)
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            extension.eq_ignore_ascii_case("md")
                || extension.eq_ignore_ascii_case("markdown")
        })
        .unwrap_or(false)
}

fn file_mtime_secs(path: &Path) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_secs()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fs::TreeOptions;
    use crate::errors::AppError;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn lists_markdown_notes_in_deterministic_relative_path_order() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("nested")).unwrap();
        fs::create_dir(dir.path().join(".hidden")).unwrap();
        fs::write(dir.path().join("z.md"), "# Z").unwrap();
        fs::write(dir.path().join("A.MD"), "# A").unwrap();
        fs::write(dir.path().join("nested/b.markdown"), "# B").unwrap();
        fs::write(dir.path().join("nested/skip.txt"), "skip").unwrap();
        fs::write(dir.path().join(".hidden/secret.md"), "secret").unwrap();

        let notes = list_markdown_notes_impl(dir.path().to_path_buf(), TreeOptions::default())
            .unwrap();

        assert_eq!(
            notes.iter().map(|note| note.rel.as_str()).collect::<Vec<_>>(),
            vec!["A.MD", "nested/b.markdown", "z.md"]
        );
        assert!(notes.iter().all(|note| note.path.is_absolute()));
        assert!(notes.iter().all(|note| note.mtime.is_some()));
    }

    #[test]
    fn honors_gitignore_only_when_requested() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("drafts")).unwrap();
        fs::write(dir.path().join(".gitignore"), "drafts/\n").unwrap();
        fs::write(dir.path().join("drafts/hidden.md"), "hidden").unwrap();
        fs::write(dir.path().join("visible.md"), "visible").unwrap();

        let visible = list_markdown_notes_impl(
            dir.path().to_path_buf(),
            TreeOptions { hide_gitignored: true, ..Default::default() },
        )
        .unwrap();
        let unfiltered = list_markdown_notes_impl(
            dir.path().to_path_buf(),
            TreeOptions::default(),
        )
        .unwrap();

        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].rel, "visible.md");
        assert_eq!(unfiltered.len(), 2);
    }

    #[test]
    fn scoped_listing_rejects_a_root_outside_the_active_vault() {
        let vault = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "secret").unwrap();
        let state = AppState::default();
        state
            .get_or_create("main")
            .set_active_vault(Some(vault.path().canonicalize().unwrap()));

        let result = list_markdown_notes_scoped(
            &state,
            "main",
            outside.path().to_path_buf(),
            TreeOptions::default(),
        );

        assert!(matches!(result, Err(AppError::InvalidPath(_))));
    }

    #[test]
    fn scoped_listing_is_scoped_to_the_calling_window() {
        let vault_a = tempdir().unwrap();
        let vault_b = tempdir().unwrap();
        fs::write(vault_a.path().join("a.md"), "a").unwrap();
        fs::write(vault_b.path().join("b.md"), "b").unwrap();
        let state = AppState::default();
        state
            .get_or_create("a")
            .set_active_vault(Some(vault_a.path().canonicalize().unwrap()));
        state
            .get_or_create("b")
            .set_active_vault(Some(vault_b.path().canonicalize().unwrap()));

        let own = list_markdown_notes_scoped(
            &state,
            "a",
            vault_a.path().to_path_buf(),
            TreeOptions::default(),
        )
        .unwrap();
        let cross = list_markdown_notes_scoped(
            &state,
            "b",
            vault_a.path().to_path_buf(),
            TreeOptions::default(),
        );

        assert_eq!(own.len(), 1);
        assert_eq!(own[0].rel, "a.md");
        assert!(matches!(cross, Err(AppError::InvalidPath(_))));
    }
}
