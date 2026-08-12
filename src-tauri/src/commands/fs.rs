use crate::errors::{AppError, Result};
use crate::state::AppState;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
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

/// Look up the calling window's active vault root, erroring if that window has
/// no vault open. Resolves `target` against it and returns the canonical,
/// in-scope path.
///
/// Scope is per window, not per process: window B opening vault B must not
/// widen (or move) window A's scope, so every command resolves through its own
/// `label`.
fn guard_path(state: &AppState, label: &str, target: &Path) -> Result<PathBuf> {
    let root = active_vault_root(state, label)?;
    resolve_in_root(&root, target)
}

fn active_vault_root(state: &AppState, label: &str) -> Result<PathBuf> {
    state.get_or_create(label).active_vault_root()
}

#[tauri::command]
pub fn list_tree<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    root: PathBuf,
    options: Option<TreeOptions>,
) -> Result<TreeNode> {
    list_tree_scoped(state.inner(), window.label(), root, options)
}

fn list_tree_scoped(
    state: &AppState,
    label: &str,
    root: PathBuf,
    options: Option<TreeOptions>,
) -> Result<TreeNode> {
    let canonical = root.canonicalize().map_err(|_| AppError::NotFound(root.display().to_string()))?;
    // `list_tree` is the authority that establishes the vault scope for *this
    // window*: the user just picked this folder in it. Record the canonical
    // root so every subsequent path-taking command from the same window can be
    // validated against it — and so no other window's scope is touched.
    state.get_or_create(label).set_active_vault(Some(canonical.clone()));
    list_tree_inner(&canonical, options)
}

fn list_tree_inner(canonical: &Path, options: Option<TreeOptions>) -> Result<TreeNode> {
    list_directory_inner(canonical, canonical, options)
}

#[tauri::command]
pub fn list_directory<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    path: PathBuf,
    options: Option<TreeOptions>,
) -> Result<TreeNode> {
    let root = active_vault_root(state.inner(), window.label())?;
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

    children.sort_by_key(sort_key);

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

// --- Save preconditions (reference behavior S2.3) --------------------------
//
// A window that has a document open remembers the digest of the bytes it last
// read (or last wrote). It hands that digest back on every save, and the write
// is refused when the file on disk no longer hashes to it — i.e. when another
// window, or another program, wrote the file in between. Without this,
// whichever window saved last silently clobbered the other's work.
//
// The digest is a content hash, not an mtime: mtime granularity on some
// filesystems is coarse enough that two saves inside the same tick are
// indistinguishable, and a content hash also makes a write-back of identical
// bytes a non-conflict, which is what the user expects.

/// FNV-1a (64-bit) over the file bytes, prefixed with the length. Not a
/// cryptographic hash and not meant to be one — nothing here defends against a
/// crafted collision, it only has to distinguish two documents a human edited.
/// Hand-rolled to keep a dependency out of the tree; `DefaultHasher` is
/// explicitly not promised to be stable, and this value crosses the IPC
/// boundary and comes back.
fn digest_bytes(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:x}-{:016x}", bytes.len(), hash)
}

/// Digest of what is on disk right now, or `None` when the file does not
/// exist. A missing file is deliberately not a conflict: saving a document
/// whose file was deleted underneath simply recreates it, as VS Code does.
fn on_disk_digest(path: &Path) -> Result<Option<String>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(digest_bytes(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Per-path locks held across the check-then-rename in `write_checked`.
///
/// Every mdwriter window lives in this one process, so an in-process lock is
/// what actually closes the TOCTOU window for the case this feature exists to
/// handle: two windows saving the same file at once. A write from a foreign
/// process can still land between the check and the rename — no portable
/// primitive prevents that, and VS Code has the same gap.
fn write_locks() -> &'static Mutex<HashMap<PathBuf, Arc<Mutex<()>>>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn write_lock_for(path: &Path) -> Arc<Mutex<()>> {
    // A poisoned registry only means some writer panicked mid-save; the map
    // itself is still coherent, so recover rather than take the process down.
    let mut map = write_locks().lock().unwrap_or_else(|e| e.into_inner());
    // Drop entries no caller holds any more, so the registry doesn't grow by
    // one entry per file touched for the lifetime of the process.
    map.retain(|_, lock| Arc::strong_count(lock) > 1);
    map.entry(path.to_path_buf()).or_default().clone()
}

/// Write `text`, refusing when `expected_digest` is given and the bytes on
/// disk no longer hash to it. Returns the digest of the bytes just written so
/// the caller can carry its precondition forward without re-reading.
fn write_checked(path: &Path, text: &str, expected_digest: Option<&str>) -> Result<String> {
    let lock = write_lock_for(path);
    let _held = lock.lock().unwrap_or_else(|e| e.into_inner());

    if let Some(expected) = expected_digest {
        if let Some(actual) = on_disk_digest(path)? {
            if actual != expected {
                return Err(AppError::SaveConflict {
                    path: path.display().to_string(),
                    expected_digest: expected.to_string(),
                    actual_digest: actual,
                });
            }
        }
    }

    write_atomic(path, text)?;
    Ok(digest_bytes(text.as_bytes()))
}

/// A file's text together with the digest of the exact bytes it was read from.
/// Read and digest happen against one `read` so the two can't disagree.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshot {
    pub text: String,
    pub digest: String,
}

/// Read a file as plain text. Frontmatter parsing now happens on the
/// frontend (see `src/lib/doc.ts`). The Rust side is a transport for
/// bytes only — keeping it free of any parse/serialize round-trip is
/// what makes the body byte-stable across saves.
///
/// The returned `digest` is the window's save precondition: hand it back to
/// `write_file` and the write is refused if disk has moved on since.
#[tauri::command]
pub fn read_file<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    path: PathBuf,
) -> Result<FileSnapshot> {
    read_file_scoped(state.inner(), window.label(), &path)
}

fn read_file_scoped(state: &AppState, label: &str, path: &Path) -> Result<FileSnapshot> {
    let path = guard_path(state, label, path)?;
    read_file_inner(&path)
}

fn read_file_inner(path: &Path) -> Result<FileSnapshot> {
    let bytes = std::fs::read(path)?;
    let digest = digest_bytes(&bytes);
    let text = String::from_utf8(bytes)
        .map_err(|e| AppError::Io(format!("{} is not valid UTF-8: {e}", path.display())))?;
    Ok(FileSnapshot { text, digest })
}

/// Write a file as plain text. The caller is responsible for the exact
/// bytes — there is no Rust-side serialize_doc that could reformat YAML.
///
/// `expected_digest` is the digest the calling window last saw for this file.
/// When present it is enforced: a mismatch returns `AppError::SaveConflict`
/// and leaves the file untouched. `None` writes unconditionally, which is
/// only correct for callers that have no read to base a precondition on.
/// Returns the digest of the bytes written.
#[tauri::command]
pub fn write_file<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    path: PathBuf,
    text: String,
    expected_digest: Option<String>,
) -> Result<String> {
    write_file_scoped(
        state.inner(),
        window.label(),
        &path,
        &text,
        expected_digest.as_deref(),
    )
}

fn write_file_scoped(
    state: &AppState,
    label: &str,
    path: &Path,
    text: &str,
    expected_digest: Option<&str>,
) -> Result<String> {
    let path = guard_path(state, label, path)?;
    write_checked(&path, text, expected_digest)
}

/// Create a new note. Seeds the file with a `# ` H1 marker so the
/// editor can land the cursor inside the heading and the user's first
/// keystroke types the note's title. The trailing space is intentional
/// — without it, BlockNote serializes the heading as `\n` and the
/// auto-rename heuristic can't pick up an empty heading.
#[tauri::command]
pub fn create_file<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    path: PathBuf,
) -> Result<()> {
    let path = guard_path(state.inner(), window.label(), &path)?;
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
pub fn create_dir<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    path: PathBuf,
) -> Result<()> {
    let path = guard_path(state.inner(), window.label(), &path)?;
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
pub fn rename_path<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    from: PathBuf,
    to: PathBuf,
) -> Result<()> {
    // Both endpoints must be inside the vault — you can't rename a vault file
    // out of scope, nor pull an external file in by renaming over it.
    let label = window.label();
    let from = guard_path(state.inner(), label, &from)?;
    let to = guard_path(state.inner(), label, &to)?;
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
pub fn trash_path<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    path: PathBuf,
) -> Result<()> {
    let path = guard_path(state.inner(), window.label(), &path)?;
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
pub fn ensure_vault_agents_md<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    vault_path: PathBuf,
) -> Result<bool> {
    let target = guard_path(state.inner(), window.label(), &vault_path.join("AGENTS.md"))?;
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
pub fn write_image<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    path: PathBuf,
    bytes_b64: String,
) -> Result<()> {
    let path = guard_path(state.inner(), window.label(), &path)?;
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
pub fn import_file<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    state: State<'_, AppState>,
    path: PathBuf,
    bytes_b64: String,
) -> Result<()> {
    let path = guard_path(state.inner(), window.label(), &path)?;
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
        assert_eq!(back.text, original);
    }

    // --- Save preconditions (reference behavior S2.3) ---------------------

    #[test]
    fn a_read_digest_matches_a_write_digest_for_the_same_bytes() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("a.md");
        let written = write_checked(&p, "hello", None).unwrap();
        assert_eq!(read_file_inner(&p).unwrap().digest, written);
    }

    #[test]
    fn digests_distinguish_content_and_length() {
        assert_ne!(digest_bytes(b"hello"), digest_bytes(b"hellp"));
        assert_ne!(digest_bytes(b"hello"), digest_bytes(b"hello "));
        assert_ne!(digest_bytes(b""), digest_bytes(b"\0"));
        assert_eq!(digest_bytes(b"hello"), digest_bytes(b"hello"));
    }

    #[test]
    fn a_save_is_refused_when_the_file_changed_underneath_it() {
        // The canonical S2 failure: window B read "v1", window A wrote "from
        // A", B saves. B's bytes must not land and B must be told why.
        let dir = tempdir().unwrap();
        let p = dir.path().join("note.md");
        std::fs::write(&p, "v1").unwrap();
        let b_read = read_file_inner(&p).unwrap();

        write_checked(&p, "from A", Some(&b_read.digest)).unwrap();

        let err = write_checked(&p, "from B", Some(&b_read.digest)).unwrap_err();
        match err {
            AppError::SaveConflict {
                expected_digest,
                actual_digest,
                ..
            } => {
                assert_eq!(expected_digest, b_read.digest);
                assert_eq!(actual_digest, digest_bytes(b"from A"));
            }
            other => panic!("expected SaveConflict, got {other:?}"),
        }
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "from A");
    }

    #[test]
    fn a_successful_save_returns_the_digest_the_next_save_needs() {
        // Without this the window would false-conflict against its own write on
        // the very next keystroke.
        let dir = tempdir().unwrap();
        let p = dir.path().join("note.md");
        std::fs::write(&p, "v1").unwrap();

        let mut digest = read_file_inner(&p).unwrap().digest;
        for text in ["v2", "v3", "v4"] {
            digest = write_checked(&p, text, Some(&digest)).unwrap();
        }
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "v4");
    }

    #[test]
    fn a_write_of_identical_bytes_is_not_a_conflict() {
        // Some other window saving the same content it already had (or an
        // editor rewriting the file byte-for-byte) is not a user-visible
        // divergence, so it must not raise a prompt.
        let dir = tempdir().unwrap();
        let p = dir.path().join("note.md");
        std::fs::write(&p, "same").unwrap();
        let digest = read_file_inner(&p).unwrap().digest;
        std::fs::write(&p, "same").unwrap();

        write_checked(&p, "mine", Some(&digest)).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "mine");
    }

    #[test]
    fn a_file_deleted_underneath_is_recreated_rather_than_refused() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("note.md");
        std::fs::write(&p, "v1").unwrap();
        let digest = read_file_inner(&p).unwrap().digest;
        std::fs::remove_file(&p).unwrap();

        write_checked(&p, "recreated", Some(&digest)).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "recreated");
    }

    #[test]
    fn no_precondition_means_no_check() {
        // Callers with nothing to base a precondition on (a first write, a
        // non-document write) keep the old unconditional behavior.
        let dir = tempdir().unwrap();
        let p = dir.path().join("note.md");
        std::fs::write(&p, "v1").unwrap();
        write_checked(&p, "forced", None).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "forced");
    }

    #[test]
    fn concurrent_saves_from_the_same_baseline_cannot_both_win() {
        // Both windows live in one process, so the check-then-rename has to be
        // serialized per path — otherwise both reads see the original bytes,
        // both checks pass, and the later rename silently clobbers the earlier
        // save with no conflict reported to anyone.
        use std::sync::mpsc;
        use std::thread;

        let dir = tempdir().unwrap();
        let p = dir.path().join("note.md");

        for attempt in 0..64 {
            std::fs::write(&p, "v1").unwrap();
            let digest = read_file_inner(&p).unwrap().digest;
            let (tx, rx) = mpsc::channel();

            let handles: Vec<_> = ["from A", "from B"]
                .into_iter()
                .map(|text| {
                    let path = p.clone();
                    let digest = digest.clone();
                    let tx = tx.clone();
                    thread::spawn(move || {
                        let _ = tx.send(write_checked(&path, text, Some(&digest)).is_ok());
                    })
                })
                .collect();
            drop(tx);
            for h in handles {
                h.join().unwrap();
            }

            let wins = rx.iter().filter(|ok| *ok).count();
            assert_eq!(wins, 1, "attempt {attempt}: both writers thought they won");
        }
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
    use std::fs;
    use tempfile::{tempdir, TempDir};

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

    // --- Per-window scope (reference behavior S1.3) -----------------------
    //
    // These drive the real command bodies (`list_tree_scoped`,
    // `read_file_scoped`, `write_file_scoped`, `guard_path`) for two window
    // labels against one `AppState`. Before the label was threaded through,
    // every one of these resolved to the single hardcoded "main" window: window
    // B's `list_tree` overwrote A's `active_vault`, after which A's reads and
    // writes of its own files failed with InvalidPath and B could read A's.

    struct TwoWindows {
        state: AppState,
        vault_a: TempDir,
        vault_b: TempDir,
    }

    /// Window "a" has opened vault A and window "b" vault B, each through the
    /// same `list_tree` the frontend calls on vault open.
    fn open_two_windows() -> TwoWindows {
        let vault_a = tempdir().unwrap();
        let vault_b = tempdir().unwrap();
        fs::write(vault_a.path().join("a.md"), "from a").unwrap();
        fs::write(vault_b.path().join("b.md"), "from b").unwrap();
        let state = AppState::default();

        list_tree_scoped(&state, "a", vault_a.path().to_path_buf(), None).unwrap();
        list_tree_scoped(&state, "b", vault_b.path().to_path_buf(), None).unwrap();

        TwoWindows {
            state,
            vault_a,
            vault_b,
        }
    }

    #[test]
    fn a_second_window_opening_a_vault_leaves_the_first_windows_scope_intact() {
        let TwoWindows {
            state,
            vault_a,
            vault_b,
        } = open_two_windows();

        assert_eq!(
            state.get("a").unwrap().active_vault_root().unwrap(),
            vault_a.path().canonicalize().unwrap()
        );
        assert_eq!(
            state.get("b").unwrap().active_vault_root().unwrap(),
            vault_b.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn reads_and_writes_are_scoped_to_the_calling_window() {
        let TwoWindows {
            state,
            vault_a,
            vault_b,
        } = open_two_windows();
        let a_md = vault_a.path().join("a.md");
        let b_md = vault_b.path().join("b.md");

        // Each window can still reach its own file...
        assert_eq!(read_file_scoped(&state, "a", &a_md).unwrap().text, "from a");
        assert_eq!(read_file_scoped(&state, "b", &b_md).unwrap().text, "from b");
        write_file_scoped(&state, "a", &a_md, "edited by a", None).unwrap();
        assert_eq!(fs::read_to_string(&a_md).unwrap(), "edited by a");

        // ...and neither can reach the other's, in either direction.
        assert!(matches!(
            read_file_scoped(&state, "b", &a_md),
            Err(AppError::InvalidPath(_))
        ));
        assert!(matches!(
            read_file_scoped(&state, "a", &b_md),
            Err(AppError::InvalidPath(_))
        ));
        assert!(matches!(
            write_file_scoped(&state, "b", &a_md, "clobbered", None),
            Err(AppError::InvalidPath(_))
        ));
        assert_eq!(fs::read_to_string(&a_md).unwrap(), "edited by a");
    }

    #[test]
    fn guard_path_is_scoped_to_the_calling_window() {
        // Covers the create/rename/trash/import family, which all resolve
        // through `guard_path` with their own window's label.
        let TwoWindows {
            state,
            vault_a,
            vault_b,
        } = open_two_windows();
        let new_in_a = vault_a.path().join("fresh.md");

        assert_eq!(
            guard_path(&state, "a", &new_in_a).unwrap(),
            vault_a.path().canonicalize().unwrap().join("fresh.md")
        );
        assert!(matches!(
            guard_path(&state, "b", &new_in_a),
            Err(AppError::InvalidPath(_))
        ));
        assert!(matches!(
            guard_path(&state, "a", &vault_b.path().join("fresh.md")),
            Err(AppError::InvalidPath(_))
        ));
    }

    #[test]
    fn two_windows_on_one_vault_cannot_clobber_each_other() {
        // S2.3 across the real per-window seam: both windows have the same
        // vault open and the same note read. A saves; B's save of its own
        // divergent buffer is refused instead of overwriting A's work.
        let vault = tempdir().unwrap();
        let note = vault.path().join("shared.md");
        fs::write(&note, "shared v1").unwrap();
        let state = AppState::default();
        list_tree_scoped(&state, "a", vault.path().to_path_buf(), None).unwrap();
        list_tree_scoped(&state, "b", vault.path().to_path_buf(), None).unwrap();

        let a_digest = read_file_scoped(&state, "a", &note).unwrap().digest;
        let b_digest = read_file_scoped(&state, "b", &note).unwrap().digest;
        assert_eq!(a_digest, b_digest, "same bytes, same precondition");

        write_file_scoped(&state, "a", &note, "A's version", Some(&a_digest)).unwrap();

        let err =
            write_file_scoped(&state, "b", &note, "B's version", Some(&b_digest)).unwrap_err();
        assert!(matches!(err, AppError::SaveConflict { .. }));
        assert_eq!(fs::read_to_string(&note).unwrap(), "A's version");

        // And B can still resolve it by overwriting on purpose (no precondition).
        write_file_scoped(&state, "b", &note, "B's version", None).unwrap();
        assert_eq!(fs::read_to_string(&note).unwrap(), "B's version");
    }

    #[test]
    fn a_window_with_no_vault_open_can_reach_nothing() {
        // S1.2: a new window starts empty, and stays empty until it opens a
        // folder of its own — it does not inherit another window's vault.
        let TwoWindows { state, vault_a, .. } = open_two_windows();

        assert!(matches!(
            read_file_scoped(&state, "fresh-window", &vault_a.path().join("a.md")),
            Err(AppError::InvalidPath(_))
        ));
    }
}
