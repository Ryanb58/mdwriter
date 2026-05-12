mod commands;
mod errors;
mod state;

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
#[cfg(debug_assertions)]
use tauri::Manager;
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state::AppState::default())
        .manage(commands::agents::AgentSession::default())
        .setup(|app| {
            let settings_item = MenuItemBuilder::new("Settings…")
                .id("settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let check_updates_item = MenuItemBuilder::new("Check for Updates…")
                .id("check-updates")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "mdwriter")
                .item(&PredefinedMenuItem::about(app, None, None)?)
                .separator()
                .item(&check_updates_item)
                .item(&settings_item)
                .separator()
                .item(&PredefinedMenuItem::services(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::hide(app, None)?)
                .item(&PredefinedMenuItem::hide_others(app, None)?)
                .item(&PredefinedMenuItem::show_all(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::quit(app, None)?)
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&PredefinedMenuItem::undo(app, None)?)
                .item(&PredefinedMenuItem::redo(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, None)?)
                .item(&PredefinedMenuItem::copy(app, None)?)
                .item(&PredefinedMenuItem::paste(app, None)?)
                .item(&PredefinedMenuItem::select_all(app, None)?)
                .build()?;

            #[cfg(debug_assertions)]
            let devtools_item = MenuItemBuilder::new("Toggle Developer Tools")
                .id("devtools")
                .accelerator("CmdOrCtrl+Alt+I")
                .build(app)?;

            #[cfg(debug_assertions)]
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&PredefinedMenuItem::fullscreen(app, None)?)
                .separator()
                .item(&devtools_item)
                .build()?;
            #[cfg(not(debug_assertions))]
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&PredefinedMenuItem::fullscreen(app, None)?)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                match event.id().as_ref() {
                    "settings" => {
                        let _ = app_handle.emit("menu:settings", ());
                    }
                    "check-updates" => {
                        let _ = app_handle.emit("menu:check-updates", ());
                    }
                    #[cfg(debug_assertions)]
                    "devtools" => {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            if w.is_devtools_open() {
                                w.close_devtools();
                            } else {
                                w.open_devtools();
                            }
                        }
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::list_tree,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::create_file,
            commands::fs::create_dir,
            commands::fs::rename_path,
            commands::fs::trash_path,
            commands::fs::write_image,
            commands::fs::import_file,
            commands::fs::ensure_vault_agents_md,
            commands::recent::get_recent_folders,
            commands::recent::push_recent_folder,
            commands::watch::start_watcher,
            commands::watch::stop_watcher,
            commands::agents::detect_agents,
            commands::agents::start_ai_session,
            commands::agents::stop_ai_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
