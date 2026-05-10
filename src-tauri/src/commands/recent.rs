use crate::errors::Result;
use std::path::PathBuf;
use tauri::Manager;

const RECENT_FILENAME: &str = "recent.json";
const MAX_RECENT: usize = 10;

fn recent_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_config_dir()
        .map_err(|e| crate::errors::AppError::Io(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(RECENT_FILENAME))
}

fn load(path: &std::path::Path) -> Vec<String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(path: &std::path::Path, list: &[String]) -> Result<()> {
    let json = serde_json::to_string_pretty(list)
        .map_err(|e| crate::errors::AppError::Io(e.to_string()))?;
    std::fs::write(path, json)?;
    Ok(())
}

fn push(mut list: Vec<String>, folder: String) -> Vec<String> {
    list.retain(|p| p != &folder);
    list.insert(0, folder);
    list.truncate(MAX_RECENT);
    list
}

#[tauri::command]
pub fn get_recent_folders(app: tauri::AppHandle) -> Result<Vec<String>> {
    let path = recent_path(&app)?;
    let mut list = load(&path);
    list.retain(|p| std::path::Path::new(p).is_dir());
    Ok(list)
}

#[tauri::command]
pub fn push_recent_folder(app: tauri::AppHandle, folder: String) -> Result<()> {
    let path = recent_path(&app)?;
    let updated = push(load(&path), folder);
    save(&path, &updated)
}

#[cfg(test)]
mod tests {
    use super::push;

    #[test]
    fn push_puts_new_at_front() {
        let result = push(vec!["a".into(), "b".into()], "c".into());
        assert_eq!(result, vec!["c", "a", "b"]);
    }

    #[test]
    fn push_dedupes() {
        let result = push(vec!["a".into(), "b".into(), "a".into()], "a".into());
        assert_eq!(result, vec!["a", "b"]);
    }

    #[test]
    fn push_caps_at_ten() {
        let mut list: Vec<String> = (0..10).map(|i| i.to_string()).collect();
        list = push(list, "new".into());
        assert_eq!(list.len(), 10);
        assert_eq!(list[0], "new");
    }
}
