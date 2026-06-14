mod commands;
mod errors;
mod state;

use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Emitter;
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
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
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
                // Never restore visibility: the window starts hidden
                // (`visible: false` in tauri.conf.json) and the frontend
                // shows it after first paint so launch never flashes an
                // unpainted frame.
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

            // Failsafe for the hidden-until-first-paint launch flow: if the
            // webview never boots (frontend crash, asset load failure), show
            // the window anyway after a grace period so the app can't end up
            // running invisibly.
            {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    if let Some(w) = app_handle.get_webview_window("main") {
                        if !w.is_visible().unwrap_or(true) {
                            log::warn!("frontend never signaled ready; showing window via failsafe");
                            let _ = w.show();
                        }
                    }
                });
            }

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
            // Quitting must not orphan a running agent subprocess — the
            // reader/waiter threads die with the app, but the spawned
            // `claude` child would keep running without this.
            if let tauri::RunEvent::Exit = event {
                commands::agents::shutdown_session(app_handle);
            }
        });
}
