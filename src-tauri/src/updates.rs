use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct UpdateStore(Mutex<Pending>);
#[derive(Default)]
struct Pending {
    update: Option<Update>,
    verified_bytes: Option<Vec<u8>>,
}
#[derive(Clone, Serialize)]
pub struct UpdateInfo { version: String, body: Option<String> }
#[derive(Clone, Serialize)]
pub struct Progress { received: u64, total: Option<u64> }

#[tauri::command]
pub async fn check_update(app: AppHandle, state: State<'_, UpdateStore>) -> Result<Option<UpdateInfo>, String> {
    if !crate::updater_configured(app.clone()) { return Err("Update channel is not configured".into()); }
    let mut pending = state.0.try_lock().map_err(|_| "Update operation in progress")?;
    if pending.verified_bytes.is_some() { return Err("An update is already ready to install".into()); }
    pending.update = None;
    let update = app.updater_builder().timeout(std::time::Duration::from_secs(15))
        .build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo { version: u.version.clone(), body: u.body.clone() });
    pending.update = update;
    Ok(info)
}

#[tauri::command]
pub async fn download_update(state: State<'_, UpdateStore>, progress: Channel<Progress>) -> Result<(), String> {
    let mut pending = state.0.try_lock().map_err(|_| "Update operation in progress")?;
    pending.verified_bytes = None;
    let update = pending.update.as_mut().ok_or("Check for an update first")?;
    update.timeout = Some(std::time::Duration::from_secs(600));
    let mut received = 0u64;
    let mut last_progress: Option<Instant> = None;
    // The official plugin verifies the signature before returning bytes.
    let bytes = update.download(|chunk, total| {
        received += chunk as u64;
        if last_progress.is_none_or(|last| last.elapsed() >= Duration::from_millis(100)) {
            let _ = progress.send(Progress { received, total });
            last_progress = Some(Instant::now());
        }
    }, || {}).await.map_err(|e| e.to_string())?;
    pending.verified_bytes = Some(bytes);
    Ok(())
}

#[tauri::command]
pub async fn install_update(state: State<'_, UpdateStore>) -> Result<(), String> {
    let pending = state.0.try_lock().map_err(|_| "Update operation in progress")?;
    let update = pending.update.as_ref().ok_or("No update selected")?;
    let bytes = pending.verified_bytes.as_ref().ok_or("Download and verify the update first")?;
    update.install(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restart_app(app: AppHandle) { app.restart(); }
