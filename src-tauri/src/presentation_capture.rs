use image::{codecs::jpeg::JpegEncoder, DynamicImage, RgbaImage};
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};
use tauri::{ipc::Response, Manager, WebviewWindow};
use windows_capture::{
    capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        GraphicsCaptureItemType, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    },
    window::Window,
};

#[derive(Serialize)]
pub struct Source {
    id: String,
    kind: &'static str,
    title: String,
}

enum Target {
    Window(Window),
    Monitor(Monitor),
}

fn sources() -> Result<Vec<(Source, Target)>, String> {
    let windows = Window::enumerate().map_err(|error| error.to_string())?;
    let monitors = Monitor::enumerate().map_err(|error| error.to_string())?;
    let mut result = Vec::new();
    for window in windows {
        let (Ok(title), Ok(pid)) = (window.title(), window.process_id()) else {
            continue;
        };
        if title.trim().is_empty() {
            continue;
        }
        result.push((
            Source {
                id: format!("window:{:x}:{pid}", window.as_raw_hwnd() as usize),
                kind: "window",
                title,
            },
            Target::Window(window),
        ));
    }
    for (index, monitor) in monitors.into_iter().enumerate() {
        result.push((
            Source {
                id: format!("monitor:{:x}", monitor.as_raw_hmonitor() as usize),
                kind: "monitor",
                title: match monitor.name() {
                    Ok(name) if !name.trim().is_empty() => format!("Экран {} · {name}", index + 1),
                    _ => format!("Экран {}", index + 1),
                },
            },
            Target::Monitor(monitor),
        ));
    }
    Ok(result)
}

fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Screen capture is only available in the main window".into())
    }
}

#[derive(Default)]
struct FrameSlot {
    latest: Option<Vec<u8>>,
    closed: bool,
}

type Frames = Arc<(Mutex<FrameSlot>, Condvar)>;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureQuality {
    width: u32,
    height: u32,
    frame_rate: u32,
}

impl CaptureQuality {
    fn validate(self) -> Result<Self, String> {
        if matches!(
            (self.width, self.height),
            (854, 480) | (1280, 720) | (1920, 1080)
        ) && matches!(self.frame_rate, 5 | 12 | 24 | 30)
        {
            Ok(self)
        } else {
            Err("Неподдерживаемое качество демонстрации".into())
        }
    }
}

struct FrameSink {
    frames: Frames,
    quality: Option<CaptureQuality>,
    last_frame: Option<Instant>,
    buffer: Vec<u8>,
}

impl GraphicsCaptureApiHandler for FrameSink {
    type Flags = (Frames, Option<CaptureQuality>);
    type Error = String;

    fn new(context: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let (frames, quality) = context.flags;
        Ok(Self {
            frames,
            quality,
            last_frame: None,
            buffer: Vec::new(),
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self
            .quality
            .zip(self.last_frame)
            .is_some_and(|(quality, last)| {
                last.elapsed() < Duration::from_secs_f64(1.0 / f64::from(quality.frame_rate))
            })
        {
            return Ok(());
        }
        self.last_frame = Some(Instant::now());
        let buffer = frame.buffer().map_err(|error| error.to_string())?;
        let image = RgbaImage::from_raw(
            buffer.width(),
            buffer.height(),
            buffer.as_nopadding_buffer(&mut self.buffer).to_vec(),
        )
        .ok_or("Invalid capture frame")?;
        let image = DynamicImage::ImageRgba8(image);
        let (width, height) = self
            .quality
            .map_or((360, 216), |quality| (quality.width, quality.height));
        let image = if image.width() > width || image.height() > height {
            image.thumbnail(width, height)
        } else {
            image
        };
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, if self.quality.is_none() { 72 } else { 82 })
            .encode_image(&image.into_rgb8())
            .map_err(|error| error.to_string())?;
        self.frames
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .latest = Some(jpeg);
        self.frames.1.notify_one();
        if self.quality.is_none() {
            control.stop();
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.frames
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .closed = true;
        self.frames.1.notify_one();
        Ok(())
    }
}

type Control = CaptureControl<FrameSink, String>;

fn start(id: &str, quality: Option<CaptureQuality>) -> Result<(Control, Frames), String> {
    fn start_target<T: TryInto<GraphicsCaptureItemType> + Send + 'static>(
        target: T,
        frames: Frames,
        quality: Option<CaptureQuality>,
    ) -> Result<Control, String> {
        FrameSink::start_free_threaded(Settings::new(
            target,
            CursorCaptureSettings::Default,
            DrawBorderSettings::Default,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Default,
            DirtyRegionSettings::Default,
            ColorFormat::Rgba8,
            (frames, quality),
        ))
        .map_err(|error| error.to_string())
    }

    let target = sources()?
        .into_iter()
        .find(|(source, _)| source.id == id)
        .map(|(_, target)| target)
        .ok_or("Источник закрыт или отключён")?;
    let frames = Frames::default();
    let control = match target {
        Target::Window(window) => start_target(window, frames.clone(), quality),
        Target::Monitor(monitor) => start_target(monitor, frames.clone(), quality),
    }?;
    Ok((control, frames))
}

struct Capture {
    id: String,
    control: Option<Control>,
    frames: Frames,
    last_read: Instant,
}

impl Drop for Capture {
    fn drop(&mut self) {
        if let Some(control) = self.control.take() {
            // Stopping waits for the capture thread, so never do it on the UI thread.
            tauri::async_runtime::spawn_blocking(move || {
                let _ = control.stop();
            });
        }
    }
}

#[derive(Default)]
pub struct CaptureState(Mutex<Option<Capture>>);

#[tauri::command]
pub async fn presentation_sources(window: WebviewWindow) -> Result<Vec<Source>, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(|| {
        sources().map(|entries| entries.into_iter().map(|(source, _)| source).collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn presentation_preview(
    window: WebviewWindow,
    source_id: String,
) -> Result<Response, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (control, frames) = start(&source_id, None)?;
        let result = (|| {
            let slot = frames.0.lock().map_err(|error| error.to_string())?;
            let (mut slot, _) = frames
                .1
                .wait_timeout_while(slot, Duration::from_millis(1500), |slot| {
                    slot.latest.is_none() && !slot.closed
                })
                .map_err(|error| error.to_string())?;
            slot.latest
                .take()
                .map(Response::new)
                .ok_or_else(|| "Превью недоступно".into())
        })();
        let _ = control.stop();
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn start_presentation_capture(
    window: WebviewWindow,
    source_id: String,
    quality: CaptureQuality,
) -> Result<String, String> {
    main_window(&window)?;
    let quality = quality.validate()?;
    let (control, frames) =
        tauri::async_runtime::spawn_blocking(move || start(&source_id, Some(quality)))
            .await
            .map_err(|error| error.to_string())??;
    let id = uuid::Uuid::new_v4().to_string();
    let capture = Capture {
        id: id.clone(),
        control: Some(control),
        frames,
        last_read: Instant::now(),
    };
    let state = window.state::<CaptureState>();
    *state.0.lock().map_err(|error| error.to_string())? = Some(capture);
    let lease = id.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let state = window.state::<CaptureState>();
            let Ok(mut current) = state.0.lock() else {
                break;
            };
            let Some(capture) = current.as_ref().filter(|capture| capture.id == lease) else {
                break;
            };
            if capture.last_read.elapsed() >= Duration::from_secs(5) {
                current.take();
                break;
            }
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn read_presentation_frame(window: WebviewWindow, id: String) -> Result<Response, String> {
    main_window(&window)?;
    let state = window.state::<CaptureState>();
    let mut current = state.0.lock().map_err(|error| error.to_string())?;
    let capture = current
        .as_mut()
        .filter(|capture| capture.id == id)
        .ok_or("Демонстрация завершена")?;
    let mut slot = capture.frames.0.lock().map_err(|error| error.to_string())?;
    if slot.closed || capture.control.as_ref().is_none_or(Control::is_finished) {
        return Err("Источник больше недоступен".into());
    }
    capture.last_read = Instant::now();
    Ok(Response::new(slot.latest.take().unwrap_or_default()))
}

#[tauri::command]
pub fn stop_presentation_capture(window: WebviewWindow, id: String) -> Result<(), String> {
    main_window(&window)?;
    let state = window.state::<CaptureState>();
    let mut current = state.0.lock().map_err(|error| error.to_string())?;
    if current.as_ref().is_some_and(|capture| capture.id == id) {
        current.take();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires an interactive Windows desktop with a monitor"]
    fn captures_selected_monitor_as_jpeg() {
        let entries = sources().expect("enumerate capture sources");
        let (source, _) = entries
            .iter()
            .find(|(source, _)| source.kind == "monitor")
            .expect("interactive monitor");
        let quality = CaptureQuality {
            width: 854,
            height: 480,
            frame_rate: 5,
        };
        let (control, frames) = start(&source.id, Some(quality)).expect("start selected monitor");
        let latest = {
            let slot = frames.0.lock().expect("frame lock");
            let (mut slot, _) = frames
                .1
                .wait_timeout_while(slot, Duration::from_secs(3), |slot| {
                    slot.latest.is_none() && !slot.closed
                })
                .expect("wait for first frame");
            slot.latest.take()
        };
        control.stop().expect("stop capture");
        let image = image::load_from_memory(&latest.expect("monitor frame")).expect("valid JPEG");
        assert!(image.width() > 0 && image.width() <= quality.width);
        assert!(image.height() > 0 && image.height() <= quality.height);
    }
}
