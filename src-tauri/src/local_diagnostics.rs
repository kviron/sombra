//! Чтение локального журнала диагностики для окна «Журнал».
//!
//! Tauri-команда живёт в приложении, а разбор файлов — в `sombra_core::diagnostic_file`,
//! чтобы общий крейт оставался без зависимости от Tauri.

use sombra_core::backend::diagnostics::Event;
use sombra_core::diagnostic_file::{clear, now, read_recent};

#[tauri::command]
pub async fn read_local_diagnostics(window: tauri::WebviewWindow) -> Result<Vec<Event>, &'static str> {
    use tauri::Manager;
    const UNAVAILABLE: &str = "LOCAL_DIAGNOSTICS_UNAVAILABLE";
    if window.label() != "main" {
        return Err(UNAVAILABLE);
    }
    let directory = window.path().app_data_dir().map_err(|_| UNAVAILABLE)?;
    tauri::async_runtime::spawn_blocking(move || read_recent(&directory, now()))
        .await
        .map_err(|_| UNAVAILABLE)?
        .map_err(|_| UNAVAILABLE)
}

/// Deletes the stored journal. Only the diagnostic files are removed; the database and
/// the rest of the application data stay intact.
#[tauri::command]
pub async fn clear_local_diagnostics(window: tauri::WebviewWindow) -> Result<(), &'static str> {
    use tauri::Manager;
    const UNAVAILABLE: &str = "LOCAL_DIAGNOSTICS_UNAVAILABLE";
    if window.label() != "main" {
        return Err(UNAVAILABLE);
    }
    let directory = window.path().app_data_dir().map_err(|_| UNAVAILABLE)?;
    tauri::async_runtime::spawn_blocking(move || clear(&directory))
        .await
        .map_err(|_| UNAVAILABLE)?
        .map_err(|_| UNAVAILABLE)
}
