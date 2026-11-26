use std::{fs::OpenOptions, io::Write, path::{Path, PathBuf}};
use base64::Engine;
use tauri::Manager;

const MAX_BYTES: usize = 10 * 1024 * 1024;

fn safe_name(name: &str) -> String {
    // Treat separators on every platform, and never accept a path from the server.
    let mut clean: String = name.chars().map(|c| {
        if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c }
    }).collect();
    let mut end = clean.len().min(160);
    while !clean.is_char_boundary(end) { end -= 1; }
    clean.truncate(end);
    clean = clean.trim_matches([' ', '.']).to_owned();
    if clean.is_empty() { clean = "Вложение".to_owned(); }
    let stem = clean.split('.').next().unwrap_or("").trim_end().to_uppercase();
    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"))
        });
    if device { clean.insert(0, '_'); }
    clean
}

fn save_unique(directory: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.len() > MAX_BYTES { return Err("Размер вложения превышает 10 МиБ.".into()); }
    let name = safe_name(name);
    let path = Path::new(&name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Вложение");
    let extension = path.extension().and_then(|s| s.to_str());
    for suffix in 0..10000 {
        let candidate = if suffix == 0 { name.clone() } else {
            match extension {
                Some(ext) => format!("{stem} ({suffix}).{ext}"),
                None => format!("{stem} ({suffix})"),
            }
        };
        let destination = directory.join(candidate);
        match OpenOptions::new().write(true).create_new(true).open(&destination) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
                    drop(file);
                    let _ = std::fs::remove_file(&destination);
                    return Err(format!("Не удалось сохранить вложение: {error}"));
                }
                return Ok(destination);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Не удалось сохранить вложение в Загрузки: {error}")),
        }
    }
    Err("Не удалось выбрать свободное имя файла в Загрузках.".into())
}

#[tauri::command]
pub async fn save_message_attachment(app: tauri::AppHandle, state: tauri::State<'_, crate::remote::Remote>, message: String, attachment_id: Option<String>) -> Result<String, String> {
    let mut request = serde_json::json!({"op":"attachment_file", "message":message});
    if let Some(id) = attachment_id { request["attachment_id"] = serde_json::json!(id); }
    let response = crate::remote::remote_api(state, request).await?;
    let data = response["data"].as_str().ok_or("Сервер вернул некорректное вложение.")?;
    if data.len() > MAX_BYTES.div_ceil(3) * 4 { return Err("Размер вложения превышает 10 МиБ.".into()); }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| "Сервер вернул повреждённое вложение.")?;
    if bytes.len() > MAX_BYTES { return Err("Размер вложения превышает 10 МиБ.".into()); }
    let name = response["name"].as_str().unwrap_or("Вложение").to_owned();
    let directory = app.path().download_dir().map_err(|_| "Не удалось найти папку Загрузки.")?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&directory).map_err(|error| format!("Не удалось открыть папку Загрузки: {error}"))?;
        save_unique(&directory, &name, &bytes).map(|path| path.to_string_lossy().into_owned())
    }).await.map_err(|_| "Не удалось сохранить вложение.".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sanitize_paths_devices_and_unicode() {
        assert_eq!(safe_name("../dir\\file:bad?.txt"), "_dir_file_bad_.txt");
        assert_eq!(safe_name("CON.txt"), "_CON.txt");
        assert_eq!(safe_name("lpt1"), "_lpt1");
        assert_eq!(safe_name("COM¹.exe"), "_COM¹.exe");
        assert_eq!(safe_name("...  "), "Вложение");
        assert_eq!(safe_name("a\0b\n.txt "), "a_b_.txt");
        assert!(safe_name(&"😀".repeat(100)).len() <= 160);
    }
    #[test]
    fn saves_without_overwriting_and_caps_bytes() {
        let directory = std::env::temp_dir().join(format!("sombra-attachment-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&directory).unwrap();
        let first = save_unique(&directory, "test.txt", b"first").unwrap();
        let second = save_unique(&directory, "test.txt", b"second").unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(first).unwrap(), b"first");
        assert_eq!(std::fs::read(second).unwrap(), b"second");
        assert!(save_unique(&directory, "large", &vec![0; MAX_BYTES + 1]).is_err());
        std::fs::remove_dir_all(&directory).unwrap();
    }
}
