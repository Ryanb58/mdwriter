mod commands;
mod errors;
mod state;
mod window_lifecycle;

use tauri::menu::{
    MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder, WINDOW_SUBMENU_ID,
};
use tauri::Emitter;
#[cfg(debug_assertions)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Dual-mode binary: when Claude Code spawns us as its MCP permission
    // server, the right env vars are set and we run as a stdio JSON-RPC
    // server instead of booting the Tauri stack. Doing this at the very
    // top means none of the Tauri / plugin init code runs in that path.
    if commands::agents::permission::embedded_mcp::should_run() {
        commands::agents::permission::embedded_mcp::run();
        return;
    }

    // Default to Info; bump to Debug in dev builds for richer diagnostics.
    // Logs fan out to stdout (visible in `tauri dev`) and a rotating file in
    // the platform log dir so release-build issues can be inspected later.
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    let builder = tauri::Builder::default();

    // single-instance must be registered FIRST in the plugin chain (per the
    // plugin docs). When a second copy launches, focus the existing window
    // instead of opening a duplicate that would fight the file watcher on the
    // same vault. Desktop-only — the plugin doesn't support mobile.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Err(error) = window_lifecycle::reveal_main_window(app) {
            log::error!("failed to reveal main window after second launch: {error}");
        }
    }));

    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log_level)
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Restore legitimate geometry, but never let a previous
                // hidden state override the app lifecycle's reveal path.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        .difference(tauri_plugin_window_state::StateFlags::VISIBLE),
                )
                .build(),
        )
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
                .item(&devtools_item)
                .build()?;

            let center_window_item = MenuItemBuilder::new("Center Window")
                .id(window_lifecycle::CENTER_WINDOW_MENU_ID)
                .build(app)?;

            let reset_window_item = MenuItemBuilder::new("Reset Window Size & Position")
                .id(window_lifecycle::RESET_WINDOW_MENU_ID)
                .build(app)?;

            let window_menu = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
                .minimize()
                .maximize_with_text("Zoom")
                .separator()
                .fullscreen()
                .separator()
                .item(&center_window_item)
                .item(&reset_window_item)
                .separator()
                .bring_all_to_front()
                .build()?;

            let menu_builder = MenuBuilder::new(app).item(&app_menu).item(&edit_menu);
            #[cfg(debug_assertions)]
            let menu_builder = menu_builder.item(&view_menu);
            let menu = menu_builder.item(&window_menu).build()?;

            app.set_menu(menu)?;

            if let Err(error) = window_lifecycle::reveal_main_window(app.handle()) {
                log::error!("failed to reveal main window during setup: {error}");
            }

            app.on_menu_event(move |app_handle, event| {
                if let Some(command) =
                    window_lifecycle::recovery_command_for_menu_id(event.id().as_ref())
                {
                    if let Err(error) = window_lifecycle::run_recovery_command(app_handle, command)
                    {
                        log::error!("failed to run window recovery command: {error}");
                    }
                    return;
                }

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
            commands::fs::list_directory,
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
            commands::search::search_vault,
            commands::watch::start_watcher,
            commands::watch::stop_watcher,
            commands::agents::detect_agents,
            commands::agents::start_ai_session,
            commands::agents::stop_ai_session,
            commands::agents::respond_permission,
            commands::agents::add_permission_rule,
            commands::chats::list_chats,
            commands::chats::read_chat,
            commands::chats::write_chat,
            commands::chats::delete_chat,
            commands::skills::list_skills,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                // Quitting must not orphan a running agent subprocess — the
                // reader/waiter threads die with the app, but the spawned
                // `claude` child would keep running without this.
                tauri::RunEvent::Exit => commands::agents::shutdown_session(app_handle),
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => {
                    if let Err(error) = window_lifecycle::reveal_main_window(app_handle) {
                        log::error!("failed to reveal main window from Dock: {error}");
                    }
                }
                _ => {}
            }
        });
}
