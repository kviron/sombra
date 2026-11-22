#[cfg(windows)]
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
#[cfg(windows)]
use std::{
    fs::{self, OpenOptions},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, SystemTime},
};
#[cfg(windows)]
use tauri::{
    webview::PageLoadEvent, PhysicalPosition, PhysicalRect, PhysicalSize,
    WebviewUrl, WebviewWindowBuilder,
};
#[cfg(windows)]
use windows::{
    core::{HSTRING, PCWSTR},
    Data::Xml::Dom::XmlDocument,
    UI::Notifications::{ToastNotification, ToastNotificationManager},
    Win32::{
        Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT},
        System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    },
};

const POPUP: &str = "direct-message-popup";

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub account: String,
    pub channel: String,
    pub message: String,
}

impl Target {
    fn validate(&self) -> Result<(), String> {
        if [&self.account, &self.channel, &self.message].into_iter().all(|id| {
            !id.is_empty() && id.len() <= 128
                && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        }) {
            Ok(())
        } else {
            Err("Invalid notification target".into())
        }
    }
}

#[derive(Default)]
pub struct NotificationTargets(Mutex<Option<Target>>);

fn require_window(label: &str, expected: &str) -> Result<(), String> {
    if label == expected { Ok(()) } else { Err("Invalid notification window".into()) }
}

// The event is a wake-up hint; only take_notification_target consumes navigation.
// Keeping one latest target bridges a not-yet-mounted/reloading main frontend.
fn activate_target(app: &tauri::AppHandle, target: Target) -> Result<(), String> {
    target.validate()?;
    *app.state::<NotificationTargets>().0.lock().map_err(|_| "Notification queue unavailable")? = Some(target.clone());
    let main = app.get_webview_window("main").ok_or("Main window unavailable")?;
    let shown = main.show();
    let restored = main.unminimize();
    let focused = main.set_focus();
    // Even if Windows refuses foreground focus, deliver navigation to the resident UI.
    let emitted = main.emit("notification-activate", target);
    shown.and(restored).and(focused).and(emitted).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn activate_message_notification(window: tauri::WebviewWindow, target: Target) -> Result<(), String> {
    require_window(window.label(), POPUP)?;
    activate_target(window.app_handle(), target)
}

#[tauri::command]
pub fn take_notification_target(window: tauri::WebviewWindow) -> Result<Option<Target>, String> {
    require_window(window.label(), "main")?;
    let state = window.state::<NotificationTargets>();
    let result = state.0.lock().map_err(|_| "Notification queue unavailable")?.take();
    Ok(result)
}

#[cfg(windows)]
#[derive(Default)]
struct PopupReady(AtomicBool);

#[cfg(windows)]
pub fn setup_popup(app: &tauri::App) -> tauri::Result<()> {
    app.manage(PopupReady::default());
    WebviewWindowBuilder::new(app, POPUP, WebviewUrl::App("direct-message-popup.html".into()))
        .title("Уведомления Sombra")
        .inner_size(340.0, 88.0)
        .visible(false)
        .focused(false)
        .focusable(true)
        .skip_taskbar(true)
        .always_on_top(true)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .on_navigation(|url| {
            matches!(url.host_str(), Some("tauri.localhost" | "127.0.0.1"))
                && url.path() == "/direct-message-popup.html"
        })
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Started {
                window.state::<PopupReady>().0.store(false, Ordering::Relaxed);
            }
        })
        .build()?;
    Ok(())
}

#[tauri::command]
pub fn notification_popup_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != POPUP {
        return Err("Invalid notification window".into());
    }
    #[cfg(windows)]
    window.state::<PopupReady>().0.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn resize_notification_popup(window: tauri::WebviewWindow, height: u32) -> Result<(), String> {
    if window.label() != POPUP || height > 320 {
        return Err("Invalid notification window dimensions".into());
    }
    #[cfg(windows)]
    {
        if height == 0 {
            return window.hide().map_err(|error| error.to_string());
        }
        let monitor = window.primary_monitor().map_err(|error| error.to_string())?
            .ok_or("No display for Sombra notification")?;
        let (position, size) = popup_bounds(*monitor.work_area(), monitor.scale_factor(), height);
        window.set_size(size)
            .and_then(|()| window.set_position(position))
            .and_then(|()| window.show())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
fn popup_bounds(
    work_area: PhysicalRect<i32, u32>,
    scale: f64,
    height: u32,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let size = tauri::LogicalSize::new(340, height).to_physical::<u32>(scale);
    let inset = (16.0 * scale).round() as i32;
    let x = (work_area.size.width as i32 - size.width as i32 - inset).max(0);
    let y = (work_area.size.height as i32 - size.height as i32 - inset).max(0);
    let position = PhysicalPosition::new(work_area.position.x + x, work_area.position.y + y);
    (position, size)
}

#[tauri::command]
pub async fn notify_direct_message(
    window: tauri::WebviewWindow,
    sender: String,
    text: String,
    avatar: Option<String>,
    target: Target,
    silent: Option<bool>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can send notifications".into());
    }
    target.validate()?;
    #[cfg(windows)]
    {
        let app = window.app_handle();
        if app.try_state::<PopupReady>().is_some_and(|ready| ready.0.load(Ordering::Relaxed))
            && app.get_webview_window(POPUP).is_some()
            && app.emit_to(POPUP, "direct-message-popup", serde_json::json!({
                "sender": sender,
                "text": text,
                "avatar": avatar,
                "target": target,
            })).is_ok()
        {
            if !silent.unwrap_or(false) { play_message_sound(); }
            return Ok(());
        }
        let app_id = app.config().identifier.clone();
        let cache = app
            .path()
            .app_local_data_dir()
            .ok()
            .map(|dir| dir.join("notification-avatars"));

        let handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let avatar_url = cache
                .zip(avatar)
                .and_then(|(cache, avatar)| cache_avatar(&cache, &avatar));
            show_toast(&app_id, &toast_xml(&sender, &text, avatar_url.as_deref()), handle, target)
                .map_err(|error| error.to_string())?;
            if !silent.unwrap_or(false) { play_message_sound(); }
            Ok(())
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (sender, text, avatar, target, silent);
        Err("Desktop message notifications are available on Windows".into())
    }
}

#[cfg(windows)]
fn play_message_sound() {
    static WAV: &[u8] = include_bytes!("../../src/features/notifications/assets/message-tone.wav");
    // SND_MEMORY reads the embedded WAV buffer, which stays valid during async playback.
    let _ = unsafe { PlaySoundW(PCWSTR(WAV.as_ptr().cast()), None, SND_MEMORY | SND_ASYNC | SND_NODEFAULT) };
}

#[cfg(windows)]
fn show_toast(app_id: &str, xml: &str, app: tauri::AppHandle, target: Target) -> windows::core::Result<()> {
    // A blocking worker has no UI apartment. Balance every successful WinRT initialization.
    unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
    let result = (|| {
        let document = XmlDocument::new()?;
        document.LoadXml(&HSTRING::from(xml))?;
        let notification = ToastNotification::CreateToastNotification(&document)?;
        // Capture trusted typed data, never toast arguments or an externally supplied URL.
        notification.Activated(&windows::Foundation::TypedEventHandler::new(move |_, _| {
            let ui_app = app.clone();
            let target = target.clone();
            let _ = app.run_on_main_thread(move || {
                if let Err(error) = activate_target(&ui_app, target) {
                    eprintln!("Could not activate Sombra notification: {error}");
                }
            });
            Ok(())
        }))?;
        // The NSIS installer stamps the same identifier on the Sombra Start Menu shortcut.
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?;
        notifier.Show(&notification)?;
        // Keep live COM event sources for the latest notifications. This is resident-process
        // activation, not a registered cold-start COM/protocol activator.
        static LIVE_TOASTS: Mutex<std::collections::VecDeque<ToastNotification>> = Mutex::new(std::collections::VecDeque::new());
        if let Ok(mut live) = LIVE_TOASTS.lock() {
            live.push_back(notification);
            while live.len() > 128 { live.pop_front(); }
        }
        Ok(())
    })();
    unsafe { RoUninitialize() };
    result
}

#[cfg(windows)]
fn toast_xml(sender: &str, text: &str, avatar_url: Option<&str>) -> String {
    let sender = escape_xml(sender);
    let text = escape_xml(text);
    let avatar = avatar_url
        .map(|url| {
            let src = escape_xml(url);
            format!(r#"<image placement="appLogoOverride" hint-crop="circle" src="{src}"/>"#)
        })
        .unwrap_or_default();
    format!(
        r#"<toast><visual><binding template="ToastGeneric"><text>{sender}</text><text>{text}</text>{avatar}</binding></visual><audio silent="true"/></toast>"#
    )
}

#[cfg(windows)]
fn escape_xml(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            '\t'
            | '\n'
            | '\r'
            | '\u{20}'..='\u{D7FF}'
            | '\u{E000}'..='\u{FFFD}'
            | '\u{10000}'..='\u{10FFFF}' => {
                escaped.push(character);
            }
            _ => {} // The XML document rejects these characters.
        }
    }
    escaped
}

#[cfg(windows)]
fn decode_avatar(avatar: &str) -> Option<(&'static str, Vec<u8>)> {
    let (header, encoded) = avatar.split_once(',')?;
    if encoded.len() > 700_000 {
        return None;
    }
    let image = STANDARD.decode(encoded).ok()?;
    let extension = match header {
        "data:image/png;base64" if image.starts_with(b"\x89PNG\r\n\x1a\n") => "png",
        "data:image/jpeg;base64" if image.starts_with(b"\xff\xd8\xff") => "jpg",
        "data:image/webp;base64"
            if image.starts_with(b"RIFF") && image.get(8..12) == Some(b"WEBP") =>
        {
            "webp"
        }
        _ => return None,
    };
    Some((extension, image))
}

#[cfg(windows)]
fn cache_avatar(cache: &Path, avatar: &str) -> Option<String> {
    let (extension, image) = decode_avatar(avatar)?;
    let digest = ring::digest::digest(&ring::digest::SHA256, &image);
    let key = URL_SAFE_NO_PAD.encode(digest);
    let path = cache.join(format!("{key}.{extension}"));
    let now = SystemTime::now();
    fs::create_dir_all(cache).ok()?;

    if !path.is_file() {
        let temporary = cache.join(uuid::Uuid::new_v4().to_string());
        if fs::write(&temporary, image)
            .and_then(|()| fs::rename(&temporary, &path))
            .is_err()
        {
            let _ = fs::remove_file(&temporary);
            if !path.is_file() {
                return None;
            }
        }
    }
    if let Ok(file) = OpenOptions::new().write(true).open(&path) {
        let _ = file.set_modified(now);
    }

    // Retain files for notification history and reclaim avatars that have fallen out of use.
    for entry in fs::read_dir(cache).into_iter().flatten().flatten() {
        if entry.path() == path {
            continue;
        }
        let expired = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > Duration::from_secs(7 * 24 * 60 * 60));
        if expired {
            let _ = fs::remove_file(entry.path());
        }
    }

    tauri::Url::from_file_path(path)
        .ok()
        .map(|url| url.to_string())
}

#[cfg(all(windows, test))]
mod tests {
    use super::*;

    #[test]
    fn target_is_bounded_typed_data_not_a_url() {
        let target = Target { account: "user-1".into(), channel: "legacy_DM-2".into(), message: "a".repeat(128) };
        assert!(target.validate().is_ok());
        assert_eq!(serde_json::from_str::<Target>(&serde_json::to_string(&target).unwrap()).unwrap(), target);
        for invalid in ["", "../main", "https://example.com", "has space", "a:b", "用户", &"x".repeat(129)] {
            let mut bad = target.clone();
            bad.channel = invalid.into();
            assert!(bad.validate().is_err(), "accepted {invalid:?}");
        }
        assert!(serde_json::from_str::<Target>(r#"{"account":"a","channel":"c","message":"m","url":"x"}"#).is_err());
    }

    #[test]
    fn notification_commands_have_exact_window_boundaries() {
        assert!(require_window(POPUP, POPUP).is_ok());
        assert!(require_window("main", "main").is_ok());
        assert!(require_window("main", POPUP).is_err());
        assert!(require_window(POPUP, "main").is_err());
        assert!(require_window("other", "main").is_err());
    }

    #[test]
    fn pending_target_is_latest_and_consumed_once() {
        let pending = NotificationTargets::default();
        let first = Target { account: "a".into(), channel: "c".into(), message: "one".into() };
        let latest = Target { message: "two".into(), ..first.clone() };
        *pending.0.lock().unwrap() = Some(first);
        *pending.0.lock().unwrap() = Some(latest.clone());
        assert_eq!(pending.0.lock().unwrap().take(), Some(latest));
        assert_eq!(pending.0.lock().unwrap().take(), None);
    }

    #[test]
    fn popup_stays_inside_a_scaled_work_area_with_negative_coordinates() {
        let work_area = tauri::PhysicalRect {
            position: tauri::PhysicalPosition::new(-1920, -100),
            size: tauri::PhysicalSize::new(1920, 1040),
        };
        let (position, size) = popup_bounds(work_area, 1.5, 168);

        assert_eq!(size, tauri::PhysicalSize::new(510, 252));
        assert_eq!(position, tauri::PhysicalPosition::new(-534, 664));
    }

    #[test]
    fn toast_xml_escapes_message_and_avatar_url() {
        let xml = toast_xml(
            "Ли & О'Нил",
            "<hi> \"friend\"\0",
            Some("file:///C:/avatars/one.png?a=1&b=2"),
        );

        assert!(xml.contains("<text>Ли &amp; О&apos;Нил</text>"));
        assert!(xml.contains("<text>&lt;hi&gt; &quot;friend&quot;</text>"));
        assert!(xml.contains(r#"placement="appLogoOverride" hint-crop="circle" src="file:///C:/avatars/one.png?a=1&amp;b=2""#));
        assert!(!xml.contains('\0'));
        assert!(!toast_xml("A", "B", None).contains("<image"));
    }

    #[test]
    fn accepts_only_local_avatar_data_with_matching_image_signature() {
        let png = include_bytes!("../icons/32x32.png");
        let encoded = STANDARD.encode(png);
        let (extension, decoded) =
            decode_avatar(&format!("data:image/png;base64,{encoded}")).unwrap();

        assert_eq!(extension, "png");
        assert_eq!(decoded, png.as_slice());
        assert!(decode_avatar(&format!("data:image/jpeg;base64,{encoded}")).is_none());
        assert!(decode_avatar("https://example.com/avatar.png").is_none());
        assert!(decode_avatar("data:image/svg+xml;base64,PHN2Zz4=").is_none());
    }
}
