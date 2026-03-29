use tauri::Manager;

mod commands;

/// Navigate the main window to a given path without a full page reload.
/// Uses the History API + popstate event — TanStack Router picks this up
/// exactly like a normal SPA link click (no React/event/timing issues).
#[tauri::command]
fn navigate_main_window(app: tauri::AppHandle, path: String) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        // pushState changes the URL without reload.
        // popstate fires TanStack Router's internal listener so it re-renders.
        let js = format!(
            "history.pushState(null,'',{path:?}); window.dispatchEvent(new PopStateEvent('popstate',{{state:null}}));",
            path = path
        );
        let _ = win.eval(&js);
    }
}

/// Create the badami temp directory and return the full path for a given filename.
/// This runs on the Rust side to avoid needing frontend fs permissions for $TEMP.
#[tauri::command]
fn ensure_temp_dir(filename: String) -> Result<String, String> {
    let dir = std::env::temp_dir().join("badami-fm");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;
    Ok(dir.join(&filename).to_string_lossy().into_owned())
}

/// Open a local file in VS Code (falls back to system default editor).
#[tauri::command]
fn open_in_code_editor(path: String) -> Result<(), String> {
    if std::process::Command::new("code").arg(&path).spawn().is_ok() {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", path.as_str()])
            .spawn()
            .map_err(|e| format!("Failed to open file: {e}"))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // Intentionally exclude SIZE: tauri-plugin-window-state has a
                // HiDPI/Retina bug where it saves physical px but restores as
                // logical px, halving the window on every cycle.
                // Window always opens at the size defined in tauri.conf.json.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            navigate_main_window,
            ensure_temp_dir,
            open_in_code_editor,
            commands::file_watch::watch_file,
            commands::file_watch::unwatch_file,
            commands::credential::save_server_password,
            commands::credential::get_server_password,
            commands::credential::delete_server_password,
            commands::credential::save_server_passphrase,
            commands::credential::get_server_passphrase,
            commands::credential::delete_server_passphrase,
            commands::credential::encrypt_pem_key,
            commands::credential::decrypt_pem_key,
            commands::session_manager::test_server_connection,
            commands::ssh::ssh_connect,
            commands::ssh::ssh_write,
            commands::ssh::ssh_resize,
            commands::ssh::ssh_disconnect,
            commands::sftp::sftp_connect,
            commands::sftp::sftp_disconnect,
            commands::sftp::sftp_list_dir,
            commands::sftp::sftp_mkdir,
            commands::sftp::sftp_rename,
            commands::sftp::sftp_delete_file,
            commands::sftp::sftp_rmdir,
            commands::sftp::sftp_read_file,
            commands::sftp::sftp_write_file,
            commands::sftp::sftp_download,
            commands::sftp::sftp_upload,
            commands::sftp::sftp_stat,
            commands::ftp::ftp_connect,
            commands::ftp::ftp_disconnect,
            commands::ftp::ftp_list_dir,
            commands::ftp::ftp_mkdir,
            commands::ftp::ftp_rename,
            commands::ftp::ftp_delete_file,
            commands::ftp::ftp_rmdir,
            commands::ftp::ftp_download,
            commands::ftp::ftp_upload,
            // Credential Manager (Phase 10)
            commands::vault::vault_get_status,
            commands::vault::vault_lock,
            commands::vault::vault_unlock,
            commands::vault::vault_set_master_password,
            commands::vault::vault_remove_master_password,
            commands::vault::vault_init,
            commands::vault::vault_encrypt,
            commands::vault::vault_decrypt,
            commands::credentials::credential_encrypt_fields,
            commands::credentials::credential_decrypt_field,
            commands::credentials::credential_copy_to_clipboard,
            commands::credentials::credential_copy_plain_to_clipboard,
            commands::totp::totp_generate_code,
            commands::totp::totp_validate_secret,
            commands::password_gen::generate_password,
            // REST API Tool (Phase 11)
            commands::api::api_send_request,
            commands::api::api_fetch_oauth2_token,
            // Database & Sync (Phase 14)
            commands::db::db_init,
            commands::db::db_query,
            commands::db::db_execute,
            commands::db::db_execute_batch,
            commands::db::db_sync,
            commands::db::db_enable_sync,
            commands::db::db_disable_sync,
            commands::db::db_get_sync_status,
            commands::db::save_sync_token,
            commands::db::get_sync_token,
            commands::db::delete_sync_token,
            commands::db::test_sync_connection,
            // Turso Platform API helpers (Phase 14.6)
            commands::db::turso_list_organizations,
            commands::db::turso_list_regions,
            commands::db::turso_create_database,
            commands::db::turso_create_token,
        ])
        .manage(commands::ssh::SshState::new())
        .manage(commands::sftp::SftpState::new())
        .manage(commands::ftp::FtpState::new())
        .manage(commands::vault::VaultState::new())
        .manage(commands::db::DbState::new())
        .manage(commands::file_watch::FileWatchState::new());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .setup(|app| {
            use tauri::{
                menu::{Menu, MenuItem},
                tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
            };

            let show_i = MenuItem::with_id(app, "show", "Show Badami", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .tooltip("Badami")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => (),
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            // After window-state restores position, validate it is on-screen.
            // Negative or very large coordinates mean the window ended up on a
            // display that no longer exists — center it in that case.
            if let Some(win) = app.get_webview_window("main") {
                let pos_ok = win.outer_position().map(|p| p.x > -200 && p.y > -200).unwrap_or(false);
                if !pos_ok {
                    let _ = win.center();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Only intercept close for the main window
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app, event| {
            match event {
                // macOS dock icon click when all windows are hidden → show main
                tauri::RunEvent::Reopen { .. } => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                }
                // Sync on app exit (Phase 14)
                tauri::RunEvent::Exit => {
                    let db_state = app.state::<commands::db::DbState>();
                    let inner = db_state.inner.clone();
                    tauri::async_runtime::block_on(async {
                        let mut guard = inner.lock().await;
                        if let Some(ref mut db_inner) = *guard {
                            if db_inner.sync_enabled {
                                let _ = db_inner.db.sync().await;
                            }
                        }
                    });
                }
                _ => {}
            }
        });
}
