/// Skill discovery for the command palette.
///
/// Scans four canonical locations and returns metadata (no body — the agent
/// reads SKILL.md at run time via its own filesystem tools). Each skill is a
/// folder containing a `SKILL.md` file with optional YAML frontmatter:
///
///   ---
///   name: critique
///   description: Short one-liner for the palette
///   ---
///   <prompt body the agent will read>
///
/// Frontmatter is optional — when absent, name falls back to the folder name
/// and description to the first 80 chars of the body.
use crate::errors::Result;
use gray_matter::{engine::YAML, Matter};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum SkillSource {
    VaultClaude,
    VaultAgents,
    UserClaude,
    UserAgents,
}

#[derive(Serialize, Debug)]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
    pub source: SkillSource,
    pub abs_path: String,
    /// Relative to vault root for vault-sourced skills, None for user-level.
    pub vault_rel_path: Option<String>,
}

#[tauri::command]
pub fn list_skills(root_path: Option<String>) -> Result<Vec<SkillMeta>> {
    let mut out: Vec<SkillMeta> = Vec::new();

    if let Some(root) = root_path.as_deref() {
        let root = Path::new(root);
        scan_dir(
            &root.join(".claude").join("skills"),
            SkillSource::VaultClaude,
            Some(root),
            &mut out,
        );
        scan_dir(
            &root.join(".agents").join("skills"),
            SkillSource::VaultAgents,
            Some(root),
            &mut out,
        );
    }

    if let Some(home) = dirs::home_dir() {
        scan_dir(
            &home.join(".claude").join("skills"),
            SkillSource::UserClaude,
            None,
            &mut out,
        );
        scan_dir(
            &home.join(".agents").join("skills"),
            SkillSource::UserAgents,
            None,
            &mut out,
        );
    }

    // Dedup by canonical path. Symlinking `~/.agents/skills/foo` to
    // `~/.claude/skills/foo` is common, and without canonicalization the same
    // SKILL.md surfaces twice with different source labels — which both looks
    // wrong and confuses cmdk's selection state. Scan order (vault first,
    // then user; claude before agents) decides which label wins.
    let mut seen: HashSet<PathBuf> = HashSet::new();
    out.retain(|skill| {
        let canonical = std::fs::canonicalize(&skill.abs_path)
            .unwrap_or_else(|_| PathBuf::from(&skill.abs_path));
        seen.insert(canonical)
    });

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

fn scan_dir(dir: &Path, source: SkillSource, vault_root: Option<&Path>, out: &mut Vec<SkillMeta>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue }
        let skill_md = path.join("SKILL.md");
        if !skill_md.is_file() { continue }
        let dir_name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let raw = match std::fs::read_to_string(&skill_md) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let (name, description) = parse_meta(&raw, &dir_name);
        let abs_path = skill_md.to_string_lossy().into_owned();
        let vault_rel_path = vault_root.and_then(|root| {
            pathdiff(&skill_md, root).map(|p| p.to_string_lossy().into_owned())
        });
        out.push(SkillMeta {
            name,
            description,
            source,
            abs_path,
            vault_rel_path,
        });
    }
}

/// Best-effort relative path. Falls back to None if the file isn't under root.
fn pathdiff(file: &Path, root: &Path) -> Option<PathBuf> {
    file.strip_prefix(root).ok().map(|p| p.to_path_buf())
}

fn parse_meta(raw: &str, dir_name: &str) -> (String, String) {
    let matter = Matter::<YAML>::new();
    let result = matter.parse(raw);
    let (fm_name, fm_desc) = match result.data {
        Some(pod) => {
            let json: serde_json::Value = pod.deserialize().unwrap_or(serde_json::Value::Null);
            let name = json
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let desc = json
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            (name, desc)
        }
        None => (None, None),
    };
    let name = fm_name.unwrap_or_else(|| dir_name.to_string());
    let description = fm_desc.unwrap_or_else(|| first_line_snippet(&result.content));
    (name, description)
}

fn first_line_snippet(body: &str) -> String {
    let first = body
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or("");
    if first.chars().count() <= 80 {
        first.to_string()
    } else {
        let truncated: String = first.chars().take(80).collect();
        format!("{}…", truncated.trim_end())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_skill(dir: &Path, name: &str, body: &str) {
        let skill_dir = dir.join(name);
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), body).unwrap();
    }

    #[test]
    fn parse_meta_uses_frontmatter() {
        let raw = "---\nname: critique\ndescription: Critique writing\n---\nbody\n";
        let (name, desc) = parse_meta(raw, "fallback");
        assert_eq!(name, "critique");
        assert_eq!(desc, "Critique writing");
    }

    #[test]
    fn parse_meta_falls_back_to_dir_and_body() {
        let raw = "First line of body that should become the description.\n\nMore.";
        let (name, desc) = parse_meta(raw, "my-skill");
        assert_eq!(name, "my-skill");
        assert!(desc.contains("First line"));
    }

    #[test]
    fn parse_meta_tolerates_malformed_yaml() {
        let raw = "---\nname: : :\nbroken: [unterminated\n---\nbody\n";
        let (name, _desc) = parse_meta(raw, "fallback");
        // Malformed YAML → frontmatter ignored, dir name wins.
        assert_eq!(name, "fallback");
    }

    #[test]
    fn first_line_snippet_truncates_long_text() {
        let snippet = first_line_snippet(&"x".repeat(200));
        assert!(snippet.ends_with('…'));
        assert!(snippet.chars().count() <= 81);
    }

    #[test]
    fn list_skills_scans_vault_paths() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        write_skill(
            &root.join(".claude/skills"),
            "summarize",
            "---\ndescription: Sum stuff\n---\nbody",
        );
        write_skill(
            &root.join(".agents/skills"),
            "outline",
            "---\ndescription: Outline\n---\nbody",
        );

        let result = list_skills(Some(root.to_string_lossy().into_owned())).unwrap();
        // Plus any user-level skills picked up from $HOME on the test runner.
        let names: Vec<&str> = result.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"summarize"));
        assert!(names.contains(&"outline"));

        let summarize = result.iter().find(|s| s.name == "summarize").unwrap();
        assert!(matches!(summarize.source, SkillSource::VaultClaude));
        assert_eq!(
            summarize.vault_rel_path.as_deref(),
            Some(".claude/skills/summarize/SKILL.md"),
        );
    }

    #[test]
    fn list_skills_skips_dirs_without_skill_md() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        let empty = root.join(".claude/skills/empty");
        fs::create_dir_all(&empty).unwrap();
        let result = list_skills(Some(root.to_string_lossy().into_owned())).unwrap();
        assert!(result.iter().all(|s| s.name != "empty"));
    }

    #[test]
    fn list_skills_with_none_root_only_scans_user_dirs() {
        // No vault root → should not panic and should return a vec
        // (possibly empty depending on the test runner's $HOME).
        let _ = list_skills(None).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn list_skills_dedups_symlinked_directories() {
        use std::os::unix::fs::symlink;
        // Use a unique skill name that can't collide with anything on the
        // developer's real $HOME (which is also scanned). The dedup invariant
        // is "no two returned skills share a canonical path" — easier to assert
        // than "exactly one with name X" given the global state.
        let unique = format!("mdwriter-test-dedup-{}", std::process::id());
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        write_skill(
            &root.join(".claude/skills"),
            &unique,
            "---\ndescription: real\n---\nbody",
        );
        let agents_skills = root.join(".agents/skills");
        std::fs::create_dir_all(&agents_skills).unwrap();
        symlink(
            root.join(format!(".claude/skills/{unique}")),
            agents_skills.join(&unique),
        )
        .unwrap();

        let result = list_skills(Some(root.to_string_lossy().into_owned())).unwrap();

        let matches: Vec<_> = result.iter().filter(|s| s.name == unique).collect();
        assert_eq!(matches.len(), 1, "symlinked duplicate should be removed");
        // First-encountered (vault-claude) wins since scan order favors it.
        assert!(matches!(matches[0].source, SkillSource::VaultClaude));

        // No two surviving skills should share a canonical path.
        let mut canonicals = std::collections::HashSet::new();
        for s in &result {
            let canon = std::fs::canonicalize(&s.abs_path).unwrap_or_else(|_| s.abs_path.clone().into());
            assert!(
                canonicals.insert(canon.clone()),
                "duplicate canonical path survived dedup: {canon:?}",
            );
        }
    }
}
