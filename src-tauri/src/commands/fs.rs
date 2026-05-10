use crate::errors::{AppError, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TreeNode {
    Dir { name: String, path: PathBuf, children: Vec<TreeNode> },
    File { name: String, path: PathBuf },
}

#[tauri::command]
pub fn list_tree(root: PathBuf) -> Result<TreeNode> {
    let canonical = root.canonicalize().map_err(|_| AppError::NotFound(root.display().to_string()))?;
    build_tree(&canonical)
}

fn build_tree(path: &Path) -> Result<TreeNode> {
    let name = path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());

    if path.is_file() {
        return Ok(TreeNode::File { name, path: path.to_path_buf() });
    }

    let mut children: Vec<TreeNode> = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        let entry_name = entry.file_name().to_string_lossy().into_owned();
        if entry_name.starts_with('.') { continue; }

        if entry_path.is_dir() {
            let subtree = build_tree(&entry_path)?;
            if has_markdown(&subtree) {
                children.push(subtree);
            }
        } else if is_markdown_file(&entry_path) {
            children.push(TreeNode::File {
                name: entry_name,
                path: entry_path,
            });
        }
    }

    children.sort_by(|a, b| sort_key(a).cmp(&sort_key(b)));

    Ok(TreeNode::Dir { name, path: path.to_path_buf(), children })
}

fn sort_key(node: &TreeNode) -> (u8, String) {
    match node {
        TreeNode::Dir { name, .. } => (0, name.to_lowercase()),
        TreeNode::File { name, .. } => (1, name.to_lowercase()),
    }
}

fn is_markdown_file(p: &Path) -> bool {
    matches!(
        p.extension().and_then(|e| e.to_str()),
        Some("md") | Some("markdown")
    )
}

fn has_markdown(node: &TreeNode) -> bool {
    match node {
        TreeNode::File { .. } => true,
        TreeNode::Dir { children, .. } => children.iter().any(has_markdown),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn lists_only_markdown_files() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        fs::write(dir.path().join("b.txt"), "").unwrap();
        let tree = list_tree(dir.path().to_path_buf()).unwrap();
        match tree {
            TreeNode::Dir { children, .. } => {
                assert_eq!(children.len(), 1);
                match &children[0] {
                    TreeNode::File { name, .. } => assert_eq!(name, "a.md"),
                    _ => panic!("expected file"),
                }
            }
            _ => panic!("expected dir"),
        }
    }

    #[test]
    fn hides_dotfiles_and_dot_dirs() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        fs::create_dir(dir.path().join(".hidden")).unwrap();
        fs::write(dir.path().join(".hidden/x.md"), "").unwrap();
        let tree = list_tree(dir.path().to_path_buf()).unwrap();
        match tree {
            TreeNode::Dir { children, .. } => assert_eq!(children.len(), 1),
            _ => panic!(),
        }
    }

    #[test]
    fn hides_subdirs_with_no_markdown() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("empty")).unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        let tree = list_tree(dir.path().to_path_buf()).unwrap();
        match tree {
            TreeNode::Dir { children, .. } => assert_eq!(children.len(), 1),
            _ => panic!(),
        }
    }

    #[test]
    fn nested_markdown_is_returned() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("notes")).unwrap();
        fs::write(dir.path().join("notes/a.md"), "").unwrap();
        let tree = list_tree(dir.path().to_path_buf()).unwrap();
        let TreeNode::Dir { children, .. } = tree else { panic!() };
        assert_eq!(children.len(), 1);
        let TreeNode::Dir { children: subc, .. } = &children[0] else { panic!() };
        assert_eq!(subc.len(), 1);
    }

    #[test]
    fn missing_root_returns_not_found() {
        let result = list_tree(PathBuf::from("/definitely/does/not/exist/zzz"));
        assert!(matches!(result, Err(AppError::NotFound(_))));
    }
}
