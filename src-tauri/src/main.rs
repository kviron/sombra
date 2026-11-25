#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod audio_device_context;
mod local_diagnostics;
use tauri::Manager;
mod screenshot;
mod updates;
mod remote;
mod attachment_download;
mod attachment_cache;
mod session_storage;
mod notifications;
#[cfg(windows)]
mod presentation_capture;
#[cfg(windows)]
mod tray;
fn data_path() -> std::path::PathBuf {
    std::env::var("MINES_DATA_DIR").map(std::path::PathBuf::from).unwrap_or_else(|_| std::env::current_dir().expect("working directory").join("data")).join("mines-db.json")
}
#[tauri::command]
fn updater_configured(app: tauri::AppHandle) -> bool {
    app.config().plugins.0.get("updater").is_some_and(|config| {
        config["pubkey"].as_str().is_some_and(|s| !s.trim().is_empty())
            && config["endpoints"].as_array().is_some_and(|urls| !urls.is_empty()
                && urls.iter().all(|u| u.as_str().is_some_and(|s| s.starts_with("https://"))))
    })
}
fn main() {
    if std::env::args().any(|a| a == "--init-backend" || a == "--backend") {
        let backend = sombra_core::backend::Backend::open(data_path()).expect("open database");
        if std::env::args().any(|a| a == "--backend") {
            tokio::runtime::Runtime::new().unwrap().block_on(sombra_core::backend::serve(backend)).expect("backend server");
        }
        return;
    }
    let mut context = tauri::generate_context!();
    let screenshot = std::env::args().skip_while(|a| a != "--screenshot").nth(1);
    #[cfg(windows)]
    {
        // Keep the main WebView's chat polling and call signaling active when it is hidden.
        let key = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
        let mut args = std::env::var_os(key).unwrap_or_default();
        args.push(" --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=CalculateNativeWinOcclusion");
        std::env::set_var(key, args);
    }
    if screenshot.is_some() {
        let profile = std::env::current_dir().expect("working directory").join("shots").join(format!("webview-{}", std::process::id()));
        std::fs::create_dir_all(&profile).expect("screenshot profile directory");
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", profile);
        for window in &mut context.config_mut().app.windows {
            window.focus = false;
            #[cfg(windows)]
            { window.always_on_bottom = true; }
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::UpdateStore::default())
        .manage(notifications::NotificationTargets::default())
        .invoke_handler(tauri::generate_handler![
            #[cfg(windows)] presentation_capture::presentation_sources,
            #[cfg(windows)] presentation_capture::presentation_preview,
            #[cfg(windows)] presentation_capture::start_presentation_capture,
            #[cfg(windows)] presentation_capture::read_presentation_frame,
            #[cfg(windows)] presentation_capture::stop_presentation_capture,
            audio_device_context::audio_device_context, screenshot::capture, remote::remote_api, remote::attachment_cache_info, remote::set_attachment_cache_limit, remote::clear_attachment_cache, attachment_download::save_message_attachment, remote::record_desktop_diagnostic, local_diagnostics::read_local_diagnostics, local_diagnostics::clear_local_diagnostics, notifications::notify_direct_message, notifications::notification_popup_ready, notifications::resize_notification_popup, notifications::activate_message_notification, notifications::take_notification_target, updater_configured, updates::check_update, updates::download_update, updates::install_update, updates::restart_app])
        .setup(move |app| {
            #[cfg(windows)]
            app.manage(presentation_capture::CaptureState::default());
            app.manage(remote::Remote::new(app.path().app_data_dir()?.join("session.dpapi"))?);
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|webview| {
                    // This only disables WebView2's built-in menu. DOM contextmenu events still reach Sombra.
                    let _ = unsafe {
                        webview.controller().CoreWebView2()
                            .and_then(|core| core.Settings())
                            .and_then(|settings| settings.SetAreDefaultContextMenusEnabled(false))
                    };
                })?;
            }
            if let Some(path) = screenshot {
                screenshot::schedule(app, path)?;
            } else {
                #[cfg(windows)]
                {
                    if let Err(error) = tray::setup(app) {
                        eprintln!("Could not create the Sombra tray icon: {error}");
                    }
                    if let Err(error) = notifications::setup_popup(app) {
                        eprintln!("Could not create the Sombra notification window: {error}");
                    }
                }
            }
            Ok(())
        })
        .run(context)
        .expect("error while running Mines");
}
