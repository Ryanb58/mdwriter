use crate::commands::frontmatter::{parse_doc, serialize_doc, ParsedDoc};
use crate::errors::{AppError, Result};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TreeNode {
    Dir { name: String, path: PathBuf, children: Vec<TreeNode> },
    File { name: String, path: PathBuf },
}

#[derive(Deserialize, Debug, Default, Clone, Copy)]
#[serde(default, rename_all = "camelCase")]
pub struct TreeOptions {
    pub include_pdfs: bool,
    pub include_images: bool,
    pub include_unsupported: bool,
    pub hide_gitignored: bool,
}

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"];
const PDF_EXTS: &[&str] = &["pdf"];

#[tauri::command]
pub fn list_tree(root: PathBuf, options: Option<TreeOptions>) -> Result<TreeNode> {
    let canonical = root.canonicalize().map_err(|_| AppError::NotFound(root.display().to_string()))?;
    let opts = options.unwrap_or_default();
    let gi = if opts.hide_gitignored { build_gitignore(&canonical) } else { None };
    build_tree(&canonical, &canonical, &opts, gi.as_ref())
}

fn build_gitignore(root: &Path) -> Option<Gitignore> {
    let mut builder = GitignoreBuilder::new(root);
    let _ = builder.add(root.join(".gitignore"));
    builder.build().ok()
}

fn build_tree(
    path: &Path,
    root: &Path,
    opts: &TreeOptions,
    gi: Option<&Gitignore>,
) -> Result<TreeNode> {
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

        let is_dir = entry_path.is_dir();
        if let Some(g) = gi {
            if g.matched(&entry_path, is_dir).is_ignore() { continue; }
        }

        if is_dir {
            let subtree = build_tree(&entry_path, root, opts, gi)?;
            if has_visible_file(&subtree) {
                children.push(subtree);
            }
        } else if is_visible_file(&entry_path, opts) {
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

fn ext_lower(p: &Path) -> Option<String> {
    p.extension().and_then(|e| e.to_str()).map(|s| s.to_lowercase())
}

fn is_markdown_file(p: &Path) -> bool {
    matches!(ext_lower(p).as_deref(), Some("md") | Some("markdown"))
}

fn is_pdf_file(p: &Path) -> bool {
    ext_lower(p).as_deref().map(|e| PDF_EXTS.contains(&e)).unwrap_or(false)
}

fn is_image_file(p: &Path) -> bool {
    ext_lower(p).as_deref().map(|e| IMAGE_EXTS.contains(&e)).unwrap_or(false)
}

fn is_visible_file(p: &Path, opts: &TreeOptions) -> bool {
    if is_markdown_file(p) { return true; }
    if opts.include_pdfs && is_pdf_file(p) { return true; }
    if opts.include_images && is_image_file(p) { return true; }
    if opts.include_unsupported && !is_markdown_file(p) && !is_pdf_file(p) && !is_image_file(p) { return true; }
    false
}

fn has_visible_file(node: &TreeNode) -> bool {
    match node {
        TreeNode::File { .. } => true,
        TreeNode::Dir { children, .. } => children.iter().any(has_visible_file),
    }
}

#[tauri::command]
pub fn read_file(path: PathBuf) -> Result<ParsedDoc> {
    let raw = std::fs::read_to_string(&path)?;
    parse_doc(&raw)
}

#[tauri::command]
pub fn write_file(path: PathBuf, doc: ParsedDoc) -> Result<()> {
    let serialized = serialize_doc(&doc)?;
    write_atomic(&path, &serialized)
}

#[tauri::command]
pub fn create_file(path: PathBuf) -> Result<()> {
    if path.exists() {
        return Err(AppError::Io(format!("already exists: {}", path.display())));
    }
    std::fs::write(&path, "")?;
    Ok(())
}

#[tauri::command]
pub fn create_dir(path: PathBuf) -> Result<()> {
    if path.exists() {
        return Err(AppError::Io(format!("already exists: {}", path.display())));
    }
    std::fs::create_dir(&path)?;
    Ok(())
}

#[tauri::command]
pub fn rename_path(from: PathBuf, to: PathBuf) -> Result<()> {
    if to.exists() {
        return Err(AppError::Io(format!("destination exists: {}", to.display())));
    }
    std::fs::rename(&from, &to)?;
    Ok(())
}

#[tauri::command]
pub fn trash_path(path: PathBuf) -> Result<()> {
    trash::delete(&path).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

fn write_atomic(path: &Path, contents: &str) -> Result<()> {
    let parent = path.parent().ok_or_else(|| AppError::InvalidPath(path.display().to_string()))?;
    let temp = parent.join(format!(".{}.tmp", path.file_name().unwrap().to_string_lossy()));
    {
        let mut f = std::fs::File::create(&temp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&temp, path)?;
    Ok(())
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
        let tree = list_tree(dir.path().to_path_buf(), None).unwrap();
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
        let tree = list_tree(dir.path().to_path_buf(), None).unwrap();
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
        let tree = list_tree(dir.path().to_path_buf(), None).unwrap();
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
        let tree = list_tree(dir.path().to_path_buf(), None).unwrap();
        let TreeNode::Dir { children, .. } = tree else { panic!() };
        assert_eq!(children.len(), 1);
        let TreeNode::Dir { children: subc, .. } = &children[0] else { panic!() };
        assert_eq!(subc.len(), 1);
    }

    #[test]
    fn missing_root_returns_not_found() {
        let result = list_tree(PathBuf::from("/definitely/does/not/exist/zzz"), None);
        assert!(matches!(result, Err(AppError::NotFound(_))));
    }

    #[test]
    fn include_pdfs_brings_pdfs_into_tree() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        fs::write(dir.path().join("b.pdf"), "").unwrap();
        let opts = TreeOptions { include_pdfs: true, ..Default::default() };
        let tree = list_tree(dir.path().to_path_buf(), Some(opts)).unwrap();
        let TreeNode::Dir { children, .. } = tree else { panic!() };
        assert_eq!(children.len(), 2);
    }

    #[test]
    fn include_images_brings_images_into_tree() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        fs::write(dir.path().join("pic.png"), "").unwrap();
        let opts = TreeOptions { include_images: true, ..Default::default() };
        let tree = list_tree(dir.path().to_path_buf(), Some(opts)).unwrap();
        let TreeNode::Dir { children, .. } = tree else { panic!() };
        assert_eq!(children.len(), 2);
    }

    #[test]
    fn include_unsupported_brings_other_files() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        fs::write(dir.path().join("notes.txt"), "").unwrap();
        let opts = TreeOptions { include_unsupported: true, ..Default::default() };
        let tree = list_tree(dir.path().to_path_buf(), Some(opts)).unwrap();
        let TreeNode::Dir { children, .. } = tree else { panic!() };
        assert_eq!(children.len(), 2);
    }

    #[test]
    fn hide_gitignored_excludes_matching_paths() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("keep.md"), "").unwrap();
        fs::write(dir.path().join("draft.md"), "").unwrap();
        fs::write(dir.path().join(".gitignore"), "draft.md\n").unwrap();
        let opts = TreeOptions { hide_gitignored: true, ..Default::default() };
        let tree = list_tree(dir.path().to_path_buf(), Some(opts)).unwrap();
        let TreeNode::Dir { children, .. } = tree else { panic!() };
        assert_eq!(children.len(), 1);
        let TreeNode::File { name, .. } = &children[0] else { panic!() };
        assert_eq!(name, "keep.md");
    }
}

#[cfg(test)]
mod write_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn write_then_read_round_trip() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("a.md");
        let doc = ParsedDoc {
            frontmatter: serde_yaml::from_str("title: Hi").unwrap(),
            body: "# Body\n".into(),
        };
        write_file(p.clone(), doc).unwrap();
        let back = read_file(p).unwrap();
        assert_eq!(back.body, "# Body\n");
    }

    #[test]
    fn write_atomic_cleans_up_on_success() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("x.md");
        write_atomic(&p, "hi").unwrap();
        assert!(p.exists());
        let temp = dir.path().join(".x.md.tmp");
        assert!(!temp.exists());
    }

    #[test]
    fn create_file_writes_empty_doc() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("new.md");
        create_file(p.clone()).unwrap();
        assert!(p.exists());
        let contents = std::fs::read_to_string(&p).unwrap();
        assert_eq!(contents, "");
    }

    #[test]
    fn create_file_errors_when_exists() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("a.md");
        std::fs::write(&p, "x").unwrap();
        assert!(create_file(p).is_err());
    }

    #[test]
    fn create_dir_makes_folder() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("sub");
        create_dir(p.clone()).unwrap();
        assert!(p.is_dir());
    }

    #[test]
    fn rename_changes_filename() {
        let dir = tempdir().unwrap();
        let from = dir.path().join("a.md");
        let to = dir.path().join("b.md");
        std::fs::write(&from, "").unwrap();
        rename_path(from.clone(), to.clone()).unwrap();
        assert!(!from.exists());
        assert!(to.exists());
    }

    #[test]
    fn rename_collision_errors() {
        let dir = tempdir().unwrap();
        let from = dir.path().join("a.md");
        let to = dir.path().join("b.md");
        std::fs::write(&from, "").unwrap();
        std::fs::write(&to, "").unwrap();
        assert!(rename_path(from, to).is_err());
    }
}
