use crate::errors::{AppError, Result};
use crate::state::AppState;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use tauri::State;

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TreeNode {
    Dir { name: String, path: PathBuf, children: Vec<TreeNode>, loaded: bool },
    File {
        name: String,
        path: PathBuf,
        /// Last-modified time as Unix seconds. `None` if the filesystem
        /// can't report it (rare) or the value is before the epoch.
        #[serde(rename = "mtime", skip_serializing_if = "Option::is_none")]
        mtime: Option<i64>,
    },
}

fn file_mtime_secs(path: &Path) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let dur = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(dur.as_secs()).ok()
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

// --- Path-scope safety ----------------------------------------------------
//
// Every fs command receives an absolute path from the frontend. Nothing in
// the WebView is trusted, so before touching the disk we resolve the target
// path and confirm it stays inside the active vault root. This blocks both
// `..` traversal and symlinks that point outside the vault.
//
// The vault root is established by `list_tree` (the first call on vault open)
// and re-affirmed by the watcher. Resolution rules:
//   * The root is canonicalized once (it must exist — it's the open folder).
//   * If the target already exists, it is canonicalized directly so symlinks
//     are followed and compared by their real location.
//   * If the target does not yet exist (create / write-new / rename dest),
//     its nearest existing ancestor is canonicalized and the remaining
//     not-yet-created components are appended lexically. Any `..` that would
//     climb above the root is rejected outright.
// The resolved, canonical path is returned so callers operate on it directly.

fn lexical_join(base: &Path, tail: &[Component<'_>]) -> Result<PathBuf> {
    let mut out = base.to_path_buf();
    for comp in tail {
        match comp {
            Component::Normal(seg) => out.push(seg),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return Err(AppError::InvalidPath(base.display().to_string()));
                }
            }
            // A leading root/prefix in the tail can't happen for a relative
            // remainder, but reject defensively rather than silently reset.
            _ => return Err(AppError::InvalidPath(base.display().to_string())),
        }
    }
    Ok(out)
}

/// Resolve `target` to a canonical path and verify it lies within `root`.
/// `root` must exist; `target` may or may not exist yet.
fn resolve_in_root(root: &Path, target: &Path) -> Result<PathBuf> {
    let root_canon = root
        .canonicalize()
        .map_err(|_| AppError::NotFound(root.display().to_string()))?;

    // Walk from `target` up to its nearest existing ancestor, canonicalize
    // that, then re-append the missing components lexically. This handles
    // create/write-new where the leaf (or several parents) don't exist yet,
    // while still following symlinks on the part of the path that is real.
    let mut existing = target;
    let mut tail: Vec<Component<'_>> = Vec::new();
    let resolved = loop {
        match existing.canonicalize() {
            Ok(c) => break lexical_join(&c, &collect_rev(&tail))?,
            Err(_) => match existing.parent() {
                Some(parent) if parent != existing => {
                    if let Some(name) = existing.file_name() {
                        tail.push(Component::Normal(name));
                    }
                    existing = parent;
                }
                // Reached the filesystem root without finding an existing
                // ancestor — the path is unanchored/bogus.
                _ => return Err(AppError::InvalidPath(target.display().to_string())),
            },
        }
    };

    if resolved == root_canon || resolved.starts_with(&root_canon) {
        Ok(resolved)
    } else {
        Err(AppError::InvalidPath(target.display().to_string()))
    }
}

// `tail` is pushed leaf-first while walking up; reverse it to root-first.
fn collect_rev<'a>(tail: &[Component<'a>]) -> Vec<Component<'a>> {
    tail.iter().rev().copied().collect()
}

/// Look up the active vault root, erroring if no vault is open. Resolves
/// `target` against it and returns the canonical, in-scope path.
fn guard_path(state: &State<'_, AppState>, target: &Path) -> Result<PathBuf> {
    let root = active_vault_root(state)?;
    resolve_in_root(&root, target)
}

fn active_vault_root(state: &State<'_, AppState>) -> Result<PathBuf> {
    state.active_vault.lock().unwrap()
        .as_ref()
        .cloned()
        .ok_or_else(|| AppError::InvalidPath("no active vault".into()))
}

#[tauri::command]
pub fn list_tree(
    state: State<'_, AppState>,
    root: PathBuf,
    options: Option<TreeOptions>,
) -> Result<TreeNode> {
    let canonical = root.canonicalize().map_err(|_| AppError::NotFound(root.display().to_string()))?;
    // `list_tree` is the authority that establishes the vault scope: the user
    // just picked this folder. Record the canonical root so every subsequent
    // path-taking command can be validated against it.
    *state.active_vault.lock().unwrap() = Some(canonical.clone());
    list_tree_inner(&canonical, options)
}

fn list_tree_inner(canonical: &Path, options: Option<TreeOptions>) -> Result<TreeNode> {
    list_directory_inner(canonical, canonical, options)
}

#[tauri::command]
pub fn list_directory(
    state: State<'_, AppState>,
    path: PathBuf,
    options: Option<TreeOptions>,
) -> Result<TreeNode> {
    let root = active_vault_root(&state)?;
    let canonical = resolve_in_root(&root, &path)?;
    list_directory_inner(&root, &canonical, options)
}

fn list_directory_inner(root: &Path, path: &Path, options: Option<TreeOptions>) -> Result<TreeNode> {
    if !path.is_dir() {
        return Err(AppError::InvalidPath(format!("not a directory: {}", path.display())));
    }
    let opts = options.unwrap_or_default();
    let gi = if opts.hide_gitignored { build_gitignore(root) } else { None };
    build_shallow_directory(path, &opts, gi.as_ref())
}

fn build_gitignore(root: &Path) -> Option<Gitignore> {
    let mut builder = GitignoreBuilder::new(root);
    let _ = builder.add(root.join(".gitignore"));
    builder.build().ok()
}

fn build_shallow_directory(
    path: &Path,
    opts: &TreeOptions,
    gi: Option<&Gitignore>,
) -> Result<TreeNode> {
    let name = path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());

    if path.is_file() {
        let mtime = file_mtime_secs(path);
        return Ok(TreeNode::File { name, path: path.to_path_buf(), mtime });
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
            children.push(TreeNode::Dir {
                name: entry_name,
                path: entry_path,
                children: Vec::new(),
                loaded: false,
            });
        } else if is_visible_file(&entry_path, opts) {
            let mtime = file_mtime_secs(&entry_path);
            children.push(TreeNode::File {
                name: entry_name,
                path: entry_path,
                mtime,
            });
        }
    }

    children.sort_by(|a, b| sort_key(a).cmp(&sort_key(b)));

    Ok(TreeNode::Dir { name, path: path.to_path_buf(), children, loaded: true })
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

/// Read a file as plain text. Frontmatter parsing now happens on the
/// frontend (see `src/lib/doc.ts`). The Rust side is a transport for
/// bytes only — keeping it free of any parse/serialize round-trip is
/// what makes the body byte-stable across saves.
#[tauri::command]
pub fn read_file(state: State<'_, AppState>, path: PathBuf) -> Result<String> {
    let path = guard_path(&state, &path)?;
    read_file_inner(&path)
}

fn read_file_inner(path: &Path) -> Result<String> {
    Ok(std::fs::read_to_string(path)?)
}

/// Write a file as plain text. The caller is responsible for the exact
/// bytes — there is no Rust-side serialize_doc that could reformat YAML.
#[tauri::command]
pub fn write_file(state: State<'_, AppState>, path: PathBuf, text: String) -> Result<()> {
    let path = guard_path(&state, &path)?;
    write_atomic(&path, &text)
}

/// Create a new note. Seeds the file with a `# ` H1 marker so the
/// editor can land the cursor inside the heading and the user's first
/// keystroke types the note's title. The trailing space is intentional
/// — without it, BlockNote serializes the heading as `\n` and the
/// auto-rename heuristic can't pick up an empty heading.
#[tauri::command]
pub fn create_file(state: State<'_, AppState>, path: PathBuf) -> Result<()> {
    let path = guard_path(&state, &path)?;
    create_file_inner(&path)
}

fn create_file_inner(path: &Path) -> Result<()> {
    if path.exists() {
        return Err(AppError::Io(format!("already exists: {}", path.display())));
    }
    std::fs::write(path, "# ")?;
    Ok(())
}

#[tauri::command]
pub fn create_dir(state: State<'_, AppState>, path: PathBuf) -> Result<()> {
    let path = guard_path(&state, &path)?;
    create_dir_inner(&path)
}

fn create_dir_inner(path: &Path) -> Result<()> {
    if path.exists() {
        return Err(AppError::Io(format!("already exists: {}", path.display())));
    }
    std::fs::create_dir(path)?;
    Ok(())
}

#[tauri::command]
pub fn rename_path(state: State<'_, AppState>, from: PathBuf, to: PathBuf) -> Result<()> {
    // Both endpoints must be inside the vault — you can't rename a vault file
    // out of scope, nor pull an external file in by renaming over it.
    let from = guard_path(&state, &from)?;
    let to = guard_path(&state, &to)?;
    rename_path_inner(&from, &to)
}

fn rename_path_inner(from: &Path, to: &Path) -> Result<()> {
    if to.exists() {
        return Err(AppError::Io(format!("destination exists: {}", to.display())));
    }
    std::fs::rename(from, to)?;
    Ok(())
}

#[tauri::command]
pub fn trash_path(state: State<'_, AppState>, path: PathBuf) -> Result<()> {
    let path = guard_path(&state, &path)?;
    trash::delete(&path).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

fn write_atomic(path: &Path, contents: &str) -> Result<()> {
    write_bytes_atomic_clobber(path, contents.as_bytes())
}

// Write to a unique temp file (random suffix) in the destination
// directory, then atomic-rename onto the target — overwriting any
// existing file. Used by text writes (write_file) that expect to
// replace the doc in place.
fn write_bytes_atomic_clobber(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidPath(path.display().to_string()))?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| AppError::Io(format!("tempfile: {e}")))?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path)
        .map_err(|e| {
            log::error!("atomic save failed for {}: {}", path.display(), e.error);
            AppError::Io(format!("persist: {}", e.error))
        })?;
    log::debug!("saved {} ({} bytes)", path.display(), bytes.len());
    Ok(())
}

// No-clobber variant: persist_noclobber atomically refuses to
// overwrite an existing destination. Avoids the prior TOCTOU race
// (`path.exists()` + `rename`) — concurrent paste handlers can't
// silently clobber each other's images.
fn write_bytes_atomic_no_clobber(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidPath(path.display().to_string()))?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| AppError::Io(format!("tempfile: {e}")))?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist_noclobber(path).map_err(|e| {
        if e.error.kind() == std::io::ErrorKind::AlreadyExists {
            AppError::Io(format!("already exists: {}", path.display()))
        } else {
            AppError::Io(format!("persist: {}", e.error))
        }
    })?;
    Ok(())
}

/// Write a default `AGENTS.md` at the vault root if one isn't already there.
/// Returns true if a new file was written, false if one already existed.
/// Used on vault open so AI agents started from the vault have a baseline
/// understanding of the format (wikilinks, H1-as-title, frontmatter).
#[tauri::command]
pub fn ensure_vault_agents_md(state: State<'_, AppState>, vault_path: PathBuf) -> Result<bool> {
    let target = guard_path(&state, &vault_path.join("AGENTS.md"))?;
    ensure_vault_agents_md_inner(&target)
}

fn ensure_vault_agents_md_inner(target: &Path) -> Result<bool> {
    if target.exists() {
        return Ok(false);
    }
    write_bytes_atomic_no_clobber(target, DEFAULT_AGENTS_MD.as_bytes())?;
    Ok(true)
}

const DEFAULT_AGENTS_MD: &str = include_str!("default_agents.md");

// The Tauri IPC JSON-encodes everything, so a multi-megabyte Vec<u8>
// arriving as `[1, 2, 3, ...]` would stall (or worse) the WebView
// message channel. Frontend base64-encodes via FileReader (fast for
// large blobs) and we decode here.
#[tauri::command]
pub fn write_image(state: State<'_, AppState>, path: PathBuf, bytes_b64: String) -> Result<()> {
    let path = guard_path(&state, &path)?;
    let bytes = decode_b64(&bytes_b64)?;
    write_image_bytes(&path, &bytes)
}

fn decode_b64(b64: &str) -> Result<Vec<u8>> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| AppError::Io(format!("invalid base64: {e}")))
}

pub fn write_image_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }
    write_bytes_atomic_no_clobber(path, bytes)
}

// Generic atomic no-clobber byte write driven from the frontend.
// Used by the Finder-drop importer to copy markdown or image bytes
// into the vault without risking an accidental overwrite.
#[tauri::command]
pub fn import_file(state: State<'_, AppState>, path: PathBuf, bytes_b64: String) -> Result<()> {
    let path = guard_path(&state, &path)?;
    let bytes = decode_b64(&bytes_b64)?;
    write_image_bytes(&path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    // Mirrors the command's behavior (canonicalize the root, then walk it)
    // without needing a Tauri `State` to exercise the tree builder.
    fn list_tree(root: PathBuf, options: Option<TreeOptions>) -> Result<TreeNode> {
        let canonical = root
            .canonicalize()
            .map_err(|_| AppError::NotFound(root.display().to_string()))?;
        list_tree_inner(&canonical, options)
    }

    fn list_directory_for_test(
        root: &Path,
        path: &Path,
        options: Option<TreeOptions>,
    ) -> Result<TreeNode> {
        let canonical_root = root.canonicalize()?;
        let canonical_path = path.canonicalize()?;
        list_directory_inner(&canonical_root, &canonical_path, options)
    }

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
    fn shows_empty_subdirs() {
        // Empty folders must appear in the tree so newly-created (empty)
        // folders are visible to the user. Sort order puts dirs first.
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("empty")).unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        let tree = list_tree(dir.path().to_path_buf(), None).unwrap();
        let TreeNode::Dir { children, .. } = tree else { panic!() };
        assert_eq!(children.len(), 2);
        match &children[0] {
            TreeNode::Dir { name, .. } => assert_eq!(name, "empty"),
            _ => panic!("expected dir first"),
        }
    }

    #[test]
    fn shows_subdirs_whose_only_contents_are_filtered() {
        // A folder containing only non-markdown files (filtered by default)
        // still appears — same reasoning as `shows_empty_subdirs`.
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("notes")).unwrap();
        fs::write(dir.path().join("notes/x.txt"), "").unwrap();
        let tree = list_tree(dir.path().to_path_buf(), None).unwrap();
        let TreeNode::Dir { children, .. } = tree else { panic!() };
        assert_eq!(children.len(), 1);
        let TreeNode::Dir { name, children: subc, .. } = &children[0] else { panic!() };
        assert_eq!(name, "notes");
        assert!(subc.is_empty());
    }

    #[test]
    fn root_listing_does_not_load_nested_markdown() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("notes")).unwrap();
        fs::write(dir.path().join("notes/a.md"), "").unwrap();
        let tree = list_tree(dir.path().to_path_buf(), None).unwrap();
        let TreeNode::Dir { children, loaded, .. } = tree else { panic!() };
        assert!(loaded);
        assert_eq!(children.len(), 1);
        let TreeNode::Dir { children: subc, loaded, .. } = &children[0] else { panic!() };
        assert!(!loaded);
        assert!(subc.is_empty());
    }

    #[test]
    fn directory_listing_loads_only_the_requested_level() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("notes/deeper")).unwrap();
        fs::write(dir.path().join("notes/a.md"), "").unwrap();
        fs::write(dir.path().join("notes/deeper/b.md"), "").unwrap();

        let listing = list_directory_for_test(
            dir.path(),
            &dir.path().join("notes"),
            None,
        ).unwrap();

        let TreeNode::Dir { children, loaded, .. } = listing else { panic!() };
        assert!(loaded);
        assert_eq!(children.len(), 2);
        let TreeNode::Dir { children, loaded, .. } = &children[0] else { panic!() };
        assert!(!loaded);
        assert!(children.is_empty());
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
    fn list_tree_populates_mtime_for_files() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "").unwrap();
        let tree = list_tree(dir.path().to_path_buf(), None).unwrap();
        let TreeNode::Dir { children, .. } = tree else { panic!() };
        let TreeNode::File { mtime, .. } = &children[0] else { panic!() };
        let secs = mtime.expect("mtime should be present on a newly-written file");
        // Sanity: within the last hour of "now" — confirms we read the real
        // filesystem mtime rather than a default/zero value.
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!(secs <= now);
        assert!(secs > now - 3600);
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
        let original = "---\ntitle: Hi\n---\n\n# Body\n";
        write_atomic(&p, original).unwrap();
        let back = read_file_inner(&p).unwrap();
        assert_eq!(back, original);
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
    fn create_file_seeds_h1_marker() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("new.md");
        create_file_inner(&p).unwrap();
        assert!(p.exists());
        let contents = std::fs::read_to_string(&p).unwrap();
        assert_eq!(contents, "# ");
    }

    #[test]
    fn create_file_errors_when_exists() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("a.md");
        std::fs::write(&p, "x").unwrap();
        assert!(create_file_inner(&p).is_err());
    }

    #[test]
    fn create_dir_makes_folder() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("sub");
        create_dir_inner(&p).unwrap();
        assert!(p.is_dir());
    }

    #[test]
    fn rename_changes_filename() {
        let dir = tempdir().unwrap();
        let from = dir.path().join("a.md");
        let to = dir.path().join("b.md");
        std::fs::write(&from, "").unwrap();
        rename_path_inner(&from, &to).unwrap();
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
        assert!(rename_path_inner(&from, &to).is_err());
    }

    #[test]
    fn write_image_bytes_writes_bytes() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("assets").join("foo.png");
        let bytes = vec![0x89, b'P', b'N', b'G', 0, 1, 2, 3];
        write_image_bytes(&p, &bytes).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), bytes);
    }

    #[test]
    fn write_image_bytes_creates_missing_parent_dirs() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("a").join("b").join("c").join("x.png");
        write_image_bytes(&p, &[1, 2, 3]).unwrap();
        assert!(p.exists());
    }

    #[test]
    fn write_image_bytes_errors_when_destination_exists() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("x.png");
        std::fs::write(&p, b"old").unwrap();
        let err = write_image_bytes(&p, &[1, 2, 3]).unwrap_err();
        assert!(matches!(err, AppError::Io(_)));
    }

    #[test]
    fn write_image_bytes_atomic_leaves_no_temp_files() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("x.png");
        write_image_bytes(&p, &[1, 2, 3]).unwrap();
        // Verify no .tmp* leftovers from tempfile in the parent directory.
        let stragglers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name() != "x.png")
            .collect();
        assert!(stragglers.is_empty(), "leftover files: {stragglers:?}");
        assert!(p.exists());
    }

    #[test]
    fn write_image_bytes_no_clobber_preserves_existing() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("x.png");
        std::fs::write(&p, b"original").unwrap();
        let err = write_image_bytes(&p, b"new").unwrap_err();
        assert!(matches!(err, AppError::Io(ref msg) if msg.starts_with("already exists:")));
        // Original contents preserved — the no-clobber rename didn't fire.
        assert_eq!(std::fs::read(&p).unwrap(), b"original");
    }

    #[test]
    fn write_image_decodes_base64() {
        use base64::Engine as _;
        let dir = tempdir().unwrap();
        let p = dir.path().join("x.png");
        let bytes = vec![0x89, b'P', b'N', b'G', 0, 1, 2, 3];
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let decoded = decode_b64(&b64).unwrap();
        write_image_bytes(&p, &decoded).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), bytes);
    }

    #[test]
    fn ensure_vault_agents_md_creates_when_missing() {
        let dir = tempdir().unwrap();
        let wrote = ensure_vault_agents_md_inner(&dir.path().join("AGENTS.md")).unwrap();
        assert!(wrote);
        let target = dir.path().join("AGENTS.md");
        assert!(target.exists());
        let contents = std::fs::read_to_string(&target).unwrap();
        assert!(contents.contains("mdwriter vault"));
        assert!(contents.contains("[[filename]]"));
    }

    #[test]
    fn ensure_vault_agents_md_leaves_existing_file_alone() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("AGENTS.md");
        std::fs::write(&target, "user-customized content").unwrap();
        let wrote = ensure_vault_agents_md_inner(&target).unwrap();
        assert!(!wrote);
        let contents = std::fs::read_to_string(&target).unwrap();
        assert_eq!(contents, "user-customized content");
    }

    #[test]
    fn import_file_writes_bytes() {
        use base64::Engine as _;
        let dir = tempdir().unwrap();
        let p = dir.path().join("dropped.md");
        let bytes = b"# Hello from Finder\n";
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        let decoded = decode_b64(&b64).unwrap();
        write_image_bytes(&p, &decoded).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), bytes);
    }

    #[test]
    fn import_file_no_clobber() {
        use base64::Engine as _;
        let dir = tempdir().unwrap();
        let p = dir.path().join("dropped.md");
        std::fs::write(&p, b"existing").unwrap();
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"new");
        let decoded = decode_b64(&b64).unwrap();
        let err = write_image_bytes(&p, &decoded).unwrap_err();
        assert!(matches!(err, AppError::Io(ref msg) if msg.starts_with("already exists:")));
        assert_eq!(std::fs::read(&p).unwrap(), b"existing");
    }

    #[test]
    fn write_image_rejects_invalid_base64() {
        let err = decode_b64("!!!not-base64!!!").unwrap_err();
        assert!(matches!(err, AppError::Io(_)));
    }
}

#[cfg(test)]
mod scope_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn allows_existing_file_inside_root() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let target = root.join("note.md");
        std::fs::write(&target, "x").unwrap();
        let resolved = resolve_in_root(root, &target).unwrap();
        assert_eq!(resolved, target.canonicalize().unwrap());
    }

    #[test]
    fn allows_the_root_itself() {
        let dir = tempdir().unwrap();
        let resolved = resolve_in_root(dir.path(), dir.path()).unwrap();
        assert_eq!(resolved, dir.path().canonicalize().unwrap());
    }

    #[test]
    fn allows_not_yet_existing_file_inside_root() {
        // create_file / write-new: leaf doesn't exist yet but its parent does.
        let dir = tempdir().unwrap();
        let target = dir.path().join("brand-new.md");
        let resolved = resolve_in_root(dir.path(), &target).unwrap();
        assert_eq!(resolved, dir.path().canonicalize().unwrap().join("brand-new.md"));
    }

    #[test]
    fn allows_nested_not_yet_existing_path() {
        // write_image creates missing parent dirs — several components may be
        // absent. The lexical remainder must still resolve under the root.
        let dir = tempdir().unwrap();
        let target = dir.path().join("assets").join("sub").join("img.png");
        let resolved = resolve_in_root(dir.path(), &target).unwrap();
        let expected = dir.path().canonicalize().unwrap().join("assets/sub/img.png");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn rejects_dotdot_traversal_above_root() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("vault");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(dir.path().join("secret.md"), "s").unwrap();
        // /tmp/.../vault/../secret.md escapes the vault.
        let target = root.join("..").join("secret.md");
        let err = resolve_in_root(&root, &target).unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(_)));
    }

    #[test]
    fn rejects_absolute_path_outside_root() {
        let dir = tempdir().unwrap();
        let other = tempdir().unwrap();
        let outside = other.path().join("elsewhere.md");
        std::fs::write(&outside, "x").unwrap();
        let err = resolve_in_root(dir.path(), &outside).unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(_)));
    }

    #[test]
    fn rejects_sibling_prefix_collision() {
        // A sibling dir sharing the root's name prefix ("vault2" vs "vault")
        // must not be treated as inside "vault" — starts_with is by component.
        let dir = tempdir().unwrap();
        let root = dir.path().join("vault");
        let sibling = dir.path().join("vault2");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&sibling).unwrap();
        let target = sibling.join("note.md");
        std::fs::write(&target, "x").unwrap();
        let err = resolve_in_root(&root, &target).unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(_)));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escaping_root() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let secret = outside.path().join("secret.md");
        std::fs::write(&secret, "top secret").unwrap();
        // A symlink living inside the vault that points outside it. Following
        // the link (canonicalize) must land outside root and be rejected.
        let link = dir.path().join("link.md");
        symlink(&secret, &link).unwrap();
        let err = resolve_in_root(dir.path(), &link).unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(_)));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_write_through_symlinked_parent_dir() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        // A symlinked directory inside the vault that targets an external dir;
        // a not-yet-existing leaf under it must resolve outside root.
        let link_dir = dir.path().join("escape");
        symlink(outside.path(), &link_dir).unwrap();
        let target = link_dir.join("planted.md");
        let err = resolve_in_root(dir.path(), &target).unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(_)));
    }

    #[test]
    fn rejects_when_no_existing_ancestor() {
        // Defensive: a path whose ancestors don't exist at all can't be
        // anchored to a real location and must be refused.
        let dir = tempdir().unwrap();
        let bogus = PathBuf::from("/nonexistent-zzz/deep/leaf.md");
        let err = resolve_in_root(dir.path(), &bogus).unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(_)));
    }

    #[test]
    fn missing_root_is_not_found() {
        let target = PathBuf::from("/whatever/x.md");
        let err = resolve_in_root(Path::new("/definitely/not/here/zzz"), &target).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }
}
