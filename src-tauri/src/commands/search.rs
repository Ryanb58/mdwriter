use crate::errors::{AppError, Result};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

#[derive(Serialize, Debug)]
pub struct SearchHit {
    pub path: PathBuf,
    pub line: u32,
    pub col_start: u32,
    pub col_end: u32,
    pub snippet: String,
}

#[derive(Serialize, Debug, Default)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
    pub files_scanned: u32,
}

#[derive(Deserialize, Debug, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub hide_gitignored: bool,
}

// Soft cap on total hits — keeps the UI responsive on huge vaults. The
// frontend shows a "more results truncated" affordance.
const MAX_HITS: usize = 500;
// Per-file cap so one verbose file can't drown out the rest.
const MAX_HITS_PER_FILE: usize = 50;
// Snippets longer than this are trimmed around the match.
const SNIPPET_WINDOW: usize = 160;
// Skip files larger than this; a 5 MiB markdown file is almost always
// machine-generated and shouldn't block the search on every keystroke.
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

#[tauri::command]
pub fn search_vault(
    root: PathBuf,
    query: String,
    options: Option<SearchOptions>,
) -> Result<SearchResult> {
    let opts = options.unwrap_or_default();
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(SearchResult::default());
    }
    let canonical = root
        .canonicalize()
        .map_err(|_| AppError::NotFound(root.display().to_string()))?;

    let needle = if opts.case_sensitive {
        trimmed.to_string()
    } else {
        trimmed.to_lowercase()
    };

    let mut walker = WalkBuilder::new(&canonical);
    walker
        .standard_filters(false)
        .hidden(true)
        .git_ignore(opts.hide_gitignored)
        .git_global(opts.hide_gitignored)
        .git_exclude(opts.hide_gitignored)
        .parents(opts.hide_gitignored)
        // The ignore crate normally requires a `.git` directory before applying
        // .gitignore rules. Vaults aren't always git repos — but if the user
        // ships a .gitignore, honor it regardless.
        .require_git(false);

    let mut hits: Vec<SearchHit> = Vec::new();
    let mut files_scanned: u32 = 0;
    let mut truncated = false;

    'outer: for dent in walker.build() {
        let dent = match dent {
            Ok(d) => d,
            Err(_) => continue,
        };
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = dent.path();
        if !is_markdown(path) {
            continue;
        }
        // Skip oversized files before the read syscall — avoids slurping a
        // 100 MB log accidentally named `.md`.
        if dent
            .metadata()
            .map(|m| m.len() > MAX_FILE_BYTES)
            .unwrap_or(false)
        {
            continue;
        }
        files_scanned += 1;

        // Stream the file line-by-line so we can break out the moment a hit
        // cap fires — never holds more than a single line in memory.
        let file = match std::fs::File::open(path) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let reader = BufReader::new(file);
        let mut hits_in_file = 0usize;
        for (i, line_res) in reader.lines().enumerate() {
            let line = match line_res {
                Ok(s) => s,
                Err(_) => break,
            };
            let haystack_owned;
            let haystack: &str = if opts.case_sensitive {
                &line
            } else {
                haystack_owned = line.to_lowercase();
                &haystack_owned
            };
            if let Some(byte_idx) = haystack.find(&needle) {
                let (snippet, col_start, col_end) =
                    make_snippet(&line, byte_idx, needle.len());
                hits.push(SearchHit {
                    path: path.to_path_buf(),
                    line: (i + 1) as u32,
                    col_start: col_start as u32,
                    col_end: col_end as u32,
                    snippet,
                });
                hits_in_file += 1;
                if hits.len() >= MAX_HITS {
                    truncated = true;
                    break 'outer;
                }
                if hits_in_file >= MAX_HITS_PER_FILE {
                    break;
                }
            }
        }
    }

    Ok(SearchResult { hits, truncated, files_scanned })
}

fn is_markdown(p: &std::path::Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

// Build a snippet centered around the match. Returns the snippet text
// and the (start, end) column range of the match within the snippet.
fn make_snippet(line: &str, byte_idx: usize, needle_len: usize) -> (String, usize, usize) {
    let line_len = line.len();
    let match_end = (byte_idx + needle_len).min(line_len);

    if line_len <= SNIPPET_WINDOW {
        return (line.to_string(), byte_idx, match_end);
    }

    // Try to center the match. Snap to char boundaries.
    let pad = SNIPPET_WINDOW / 2;
    let raw_start = byte_idx.saturating_sub(pad);
    let raw_end = (match_end + pad).min(line_len);
    let start = floor_char_boundary(line, raw_start);
    let end = ceil_char_boundary(line, raw_end);

    let mut out = String::with_capacity(end - start + 6);
    let leading = start > 0;
    let trailing = end < line_len;
    if leading {
        out.push_str("…");
    }
    out.push_str(&line[start..end]);
    if trailing {
        out.push_str("…");
    }

    // Recompute column offsets relative to the snippet, accounting for the
    // leading ellipsis (3 bytes).
    let prefix = if leading { "…".len() } else { 0 };
    let col_start = prefix + (byte_idx - start);
    let col_end = prefix + (match_end - start);
    (out, col_start, col_end)
}

fn floor_char_boundary(s: &str, mut idx: usize) -> usize {
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

fn ceil_char_boundary(s: &str, mut idx: usize) -> usize {
    while idx < s.len() && !s.is_char_boundary(idx) {
        idx += 1;
    }
    idx
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn finds_basic_match() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "hello world\nsecond line\n").unwrap();
        let r = search_vault(
            dir.path().to_path_buf(),
            "world".into(),
            None,
        )
        .unwrap();
        assert_eq!(r.hits.len(), 1);
        assert_eq!(r.hits[0].line, 1);
        assert_eq!(r.hits[0].snippet, "hello world");
        assert_eq!(r.hits[0].col_start, 6);
        assert_eq!(r.hits[0].col_end, 11);
    }

    #[test]
    fn case_insensitive_by_default() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "Hello World\n").unwrap();
        let r = search_vault(dir.path().to_path_buf(), "world".into(), None).unwrap();
        assert_eq!(r.hits.len(), 1);
    }

    #[test]
    fn case_sensitive_when_requested() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "Hello World\nhello world\n").unwrap();
        let opts = SearchOptions { case_sensitive: true, ..Default::default() };
        let r = search_vault(dir.path().to_path_buf(), "world".into(), Some(opts)).unwrap();
        assert_eq!(r.hits.len(), 1);
        assert_eq!(r.hits[0].line, 2);
    }

    #[test]
    fn empty_query_returns_nothing() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "anything\n").unwrap();
        let r = search_vault(dir.path().to_path_buf(), "   ".into(), None).unwrap();
        assert!(r.hits.is_empty());
        assert_eq!(r.files_scanned, 0);
    }

    #[test]
    fn skips_non_markdown_files() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "needle\n").unwrap();
        fs::write(dir.path().join("b.txt"), "needle\n").unwrap();
        let r = search_vault(dir.path().to_path_buf(), "needle".into(), None).unwrap();
        assert_eq!(r.hits.len(), 1);
        assert!(r.hits[0].path.ends_with("a.md"));
    }

    #[test]
    fn recurses_into_subdirs() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub").join("nested.md"), "deep needle\n").unwrap();
        let r = search_vault(dir.path().to_path_buf(), "needle".into(), None).unwrap();
        assert_eq!(r.hits.len(), 1);
    }

    #[test]
    fn snippet_trims_long_lines_around_match() {
        let dir = tempdir().unwrap();
        let prefix = "a".repeat(300);
        let suffix = "b".repeat(300);
        let line = format!("{}needle{}", prefix, suffix);
        fs::write(dir.path().join("a.md"), &line).unwrap();
        let r = search_vault(dir.path().to_path_buf(), "needle".into(), None).unwrap();
        assert_eq!(r.hits.len(), 1);
        let h = &r.hits[0];
        assert!(h.snippet.contains("needle"));
        assert!(h.snippet.starts_with("…"));
        assert!(h.snippet.ends_with("…"));
        assert!(h.snippet.len() < line.len());
        // Column range should still point at "needle" inside the snippet.
        assert_eq!(&h.snippet[h.col_start as usize..h.col_end as usize], "needle");
    }

    #[test]
    fn caps_hits_per_file() {
        let dir = tempdir().unwrap();
        let mut body = String::new();
        for _ in 0..(MAX_HITS_PER_FILE + 20) {
            body.push_str("needle\n");
        }
        fs::write(dir.path().join("a.md"), body).unwrap();
        let r = search_vault(dir.path().to_path_buf(), "needle".into(), None).unwrap();
        assert_eq!(r.hits.len(), MAX_HITS_PER_FILE);
    }

    #[test]
    fn hides_dotfile_dirs() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join(".hidden")).unwrap();
        fs::write(dir.path().join(".hidden").join("x.md"), "needle\n").unwrap();
        fs::write(dir.path().join("visible.md"), "needle\n").unwrap();
        let r = search_vault(dir.path().to_path_buf(), "needle".into(), None).unwrap();
        assert_eq!(r.hits.len(), 1);
        assert!(r.hits[0].path.ends_with("visible.md"));
    }

    #[test]
    fn honors_gitignore_when_requested() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(".gitignore"), "drafts/\n").unwrap();
        fs::create_dir(dir.path().join("drafts")).unwrap();
        fs::write(dir.path().join("drafts").join("d.md"), "needle\n").unwrap();
        fs::write(dir.path().join("public.md"), "needle\n").unwrap();
        let opts = SearchOptions { hide_gitignored: true, ..Default::default() };
        let r = search_vault(dir.path().to_path_buf(), "needle".into(), Some(opts)).unwrap();
        assert_eq!(r.hits.len(), 1);
        assert!(r.hits[0].path.ends_with("public.md"));
    }

    #[test]
    fn unicode_safe_snippet() {
        let dir = tempdir().unwrap();
        let line = format!("{}needle{}", "✨".repeat(80), "🌟".repeat(80));
        fs::write(dir.path().join("a.md"), &line).unwrap();
        let r = search_vault(dir.path().to_path_buf(), "needle".into(), None).unwrap();
        assert_eq!(r.hits.len(), 1);
        let h = &r.hits[0];
        assert_eq!(&h.snippet[h.col_start as usize..h.col_end as usize], "needle");
    }
}
