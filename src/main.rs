#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod backend;
use tauri::Manager;
mod screenshot;
mod updates;
mod remote;
mod session_storage;
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
        let backend = backend::Backend::open(data_path()).expect("open database");
        if std::env::args().any(|a| a == "--backend") {
            tokio::runtime::Runtime::new().unwrap().block_on(backend::serve(backend)).expect("backend server");
        }
        return;
    }
    let mut context = tauri::generate_context!();
    let screenshot = std::env::args().skip_while(|a| a != "--screenshot").nth(1);
    if screenshot.is_some() {
        let profile = std::env::current_dir().expect("working directory").join("shots").join(format!("webview-{}", std::process::id()));
        std::fs::create_dir_all(&profile).expect("screenshot profile directory");
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", profile);
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=CalculateNativeWinOcclusion");
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
        .invoke_handler(tauri::generate_handler![screenshot::capture, remote::remote_api, updater_configured, updates::check_update, updates::download_update, updates::install_update, updates::restart_app])
        .setup(move |app| {
            app.manage(remote::Remote::new(app.path().app_data_dir()?.join("session.dpapi"))?);
            if let Some(path) = screenshot { screenshot::schedule(app, path)?; }
            Ok(())
        })
        .run(context)
        .expect("error while running Mines");
}
