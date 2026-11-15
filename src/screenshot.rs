use std::sync::Mutex;
use tauri::Manager;

pub struct ScreenshotPath(Mutex<Option<String>>);

pub fn schedule(app: &tauri::App, path: String) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(ScreenshotPath(Mutex::new(Some(path))));
    let window = app.get_webview_window("main").ok_or("main window missing")?;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let _ = window.eval("(async () => { await document.fonts.ready; let frames = 0; function frame() { if (++frames >= 120) { window.__TAURI_INTERNALS__.invoke('capture'); } else { requestAnimationFrame(frame); } } requestAnimationFrame(frame); })()");
    });
    Ok(())
}

#[tauri::command]
pub fn capture(window: tauri::WebviewWindow, app: tauri::AppHandle, state: tauri::State<ScreenshotPath>) -> Result<(), String> {
    let path = state.0.lock().map_err(|e| e.to_string())?.take().ok_or("No screenshot requested")?;
    #[cfg(windows)]
    window.with_webview(move |webview| {
        use webview2_com::{CapturePreviewCompletedHandler, Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG};
        use windows::{core::HSTRING, Win32::{UI::Shell::SHCreateStreamOnFileEx, System::Com::{STGM_CREATE, STGM_WRITE, STGM_SHARE_EXCLUSIVE, STGC_DEFAULT, IStream}}};
        let result = (|| -> windows::core::Result<()> {
            unsafe {
                let stream = SHCreateStreamOnFileEx(&HSTRING::from(path), (STGM_CREATE | STGM_WRITE | STGM_SHARE_EXCLUSIVE).0, 0, true, None::<&IStream>)?;
                let saved = stream.clone();
                let done = app.clone();
                let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                    let success = result.and_then(|_| saved.Commit(STGC_DEFAULT));
                    drop(saved);
                    done.exit(if success.is_ok() { 0 } else { 1 });
                    success
                }));
                webview.controller().CoreWebView2()?.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler)?;
            }
            Ok(())
        })();
        if let Err(error) = result { eprintln!("Screenshot failed: {error}"); app.exit(1); }
    }).map_err(|e| e.to_string())?;
    Ok(())
}
