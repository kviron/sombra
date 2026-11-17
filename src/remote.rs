use crate::backend::diagnostics::{desktop_runtime_category, operation, Event, MAX_EVENTS, REPORT_BATCH};
use serde_json::{json, Value};
use std::{collections::VecDeque, fs, io::Write, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{Duration, Instant}};
const API: &str = "https://sombra.mi-nerva.ru/api";
const LOG_MAX_BYTES: u64 = 64 * 1024;

#[derive(Default)]
struct DesktopDiagnostics {
    pending: VecDeque<Event>,
    uploading: bool,
    retry_at: Option<Instant>,
}

pub struct Remote {
    client: reqwest::Client,
    cookie: Mutex<String>,
    path: PathBuf,
    diagnostics: Arc<Mutex<DesktopDiagnostics>>,
}

impl Remote {
    pub fn new(path: PathBuf) -> Result<Self, reqwest::Error> {
        // reqwest uses rustls-no-provider; install one before constructing any client.
        // A previously installed provider is valid too (including repeated initialization).
        let _ = rustls::crypto::ring::default_provider().install_default();
        Ok(Self {
            client: reqwest::Client::builder().timeout(Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none()).build()?,
            cookie: Mutex::new(crate::session_storage::load(&path)),
            path,
            diagnostics: Arc::default(),
        })
    }

    fn record_failure(&self, name: &str, category: &'static str, status: Option<u16>) {
        let name = operation(name);
        if matches!(name, "diagnostics_recent" | "diagnostics_report") {
            return;
        }
        let event = Event::desktop(name, category, status);
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            if let Some(directory) = self.path.parent() {
                let _ = write_diagnostic(directory, &event);
            }
            // Ordinary HTTP rejections are already visible in the server log.
            if category != "http_error" || status.is_some_and(|code| code >= 500) {
                if diagnostics.pending.len() == MAX_EVENTS {
                    diagnostics.pending.pop_front();
                }
                diagnostics.pending.push_back(event);
            }
        }
    }

    fn flush_diagnostics(&self) {
        let cookie = match self.cookie.lock() {
            Ok(cookie) if cookie.starts_with("mines_session=") && cookie.as_str() != "mines_session=" => cookie.clone(),
            _ => return,
        };
        let Ok(mut diagnostics) = self.diagnostics.lock() else { return };
        if diagnostics.uploading || diagnostics.pending.is_empty() || diagnostics.retry_at.is_some_and(|retry| retry > Instant::now()) {
            return;
        }
        diagnostics.uploading = true;
        let count = REPORT_BATCH.min(diagnostics.pending.len());
        let events: Vec<_> = diagnostics.pending.drain(..count).collect();
        let pending = Arc::clone(&self.diagnostics);
        let client = self.client.clone();
        tauri::async_runtime::spawn(async move {
            let response = client.post(API).timeout(Duration::from_secs(5)).header(reqwest::header::COOKIE, cookie)
                .json(&json!({"op": "diagnostics_report", "events": events})).send().await;
            if let Ok(mut diagnostics) = pending.lock() {
                diagnostics.uploading = false;
                let retry_in = match response {
                    Ok(response) if response.status().is_success() => return,
                    Ok(response) if response.status() == reqwest::StatusCode::BAD_REQUEST => Duration::from_secs(60),
                    _ => Duration::from_secs(10),
                };
                diagnostics.retry_at = Some(Instant::now() + retry_in);
                for event in events.into_iter().rev() {
                    diagnostics.pending.push_front(event);
                }
                while diagnostics.pending.len() > MAX_EVENTS {
                    diagnostics.pending.pop_front();
                }
            }
        });
    }
}

fn write_diagnostic(directory: &Path, event: &Event) -> std::io::Result<()> {
    let mut line = serde_json::to_vec(event)?;
    line.push(b'\n');
    fs::create_dir_all(directory)?;
    let path = directory.join("diagnostics.jsonl");
    match fs::metadata(&path) {
        Ok(info) if info.len() + line.len() as u64 > LOG_MAX_BYTES => {
            fs::rename(&path, directory.join("diagnostics.previous.jsonl"))?;
        }
        Ok(_) => {},
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
        Err(error) => return Err(error),
    }
    fs::OpenOptions::new().create(true).append(true).open(path)?.write_all(&line)
}

fn session_cookie(header: &str) -> Option<String> {
    let pair = header.split(';').next()?.trim();
    pair.strip_prefix("mines_session=").map(|_| pair.to_owned())
}
#[tauri::command]
pub fn record_desktop_diagnostic(state: tauri::State<'_, Remote>, operation: &str, category: &str) {
    if let Some(category) = desktop_runtime_category(operation, category) {
        state.record_failure(operation, category, None);
        state.flush_diagnostics();
    }
}

#[tauri::command]
pub async fn remote_api(state: tauri::State<'_, Remote>, mut request: Value) -> Result<Value, String> {
    if let Some(object) = request.as_object_mut() { object.remove("token"); }
    let op = operation(request["op"].as_str().unwrap_or_default());
    let cookie = state.cookie.lock().map_err(|_| {
        state.record_failure(op, "session_storage", None);
        "Session unavailable"
    })?.clone();
    let mut outgoing = state.client.post(API).json(&request);
    if !cookie.is_empty() { outgoing = outgoing.header(reqwest::header::COOKIE, cookie); }
    if op == "voice_poll" { outgoing = outgoing.timeout(Duration::from_secs(5)); }
    if op == "attachment_file" || (op == "message" && request.get("attachment").is_some()) {
        outgoing = outgoing.timeout(Duration::from_secs(90));
    }
    let response = outgoing.send().await.map_err(|error| {
        state.record_failure(op, if error.is_timeout() { "timeout" } else { "transport" }, None);
        "REMOTE_UNAVAILABLE:Не удалось связаться с сервером Sombra. Проверьте подключение и повторите попытку."
    })?;
    let status = response.status();
    let record_failure = |category| state.record_failure(op, category, Some(status.as_u16()));
    if !status.is_success() {
        record_failure("http_error");
    }
    for value in response.headers().get_all(reqwest::header::SET_COOKIE) {
        if let Some(cookie) = value.to_str().ok().and_then(session_cookie) {
            crate::session_storage::save(&state.path, &cookie).inspect_err(|_| record_failure("session_storage"))?;
            *state.cookie.lock().map_err(|_| {
                record_failure("session_storage");
                "Session unavailable"
            })? = cookie;
        }
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        state.cookie.lock().map_err(|_| {
            record_failure("session_storage");
            "Session unavailable"
        })?.clear();
        crate::session_storage::save(&state.path, "").inspect_err(|_| record_failure("session_storage"))?;
        return Err("AUTH_REQUIRED".into());
    }
    if op == "voice_poll" && status.is_server_error() {
        return Err(format!("REMOTE_UNAVAILABLE:Сервер временно недоступен ({status})"));
    }
    let body: Value = response.json().await.map_err(|error| {
        record_failure(if error.is_timeout() { "timeout" } else { "invalid_response" });
        if error.is_timeout() {
            "REMOTE_UNAVAILABLE:Сервер Sombra слишком долго отвечает."
        } else {
            "Некорректный ответ сервера Sombra"
        }
    })?;
    if let Some(error) = body.get("error").and_then(Value::as_str) { return Err(error.into()); }
    if !status.is_success() { return Err(format!("Сервер временно недоступен ({status})")); }
    let data = body.get("data").cloned().ok_or_else(|| {
        record_failure("invalid_response");
        "Некорректный ответ сервера Sombra"
    })?;
    state.flush_diagnostics();
    Ok(data)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_log_rotates_and_omits_arbitrary_operation_names() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let client = Remote::new(directory.join("session.dpapi")).unwrap();
        for _ in 0..1200 {
            client.record_failure("private-operation-value", "transport", None);
        }
        for name in ["diagnostics.jsonl", "diagnostics.previous.jsonl"] {
            let bytes = std::fs::read(directory.join(name)).unwrap();
            assert!(bytes.len() <= 64 * 1024);
            let last: Value = serde_json::from_str(std::str::from_utf8(&bytes).unwrap().lines().last().unwrap()).unwrap();
            assert_eq!(last["operation"], "unknown");
            assert_eq!(last["category"], "transport");
            assert!(!String::from_utf8(bytes).unwrap().contains("private-operation-value"));
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn remote_client_starts_without_prior_tls_initialization() {
        let path = std::env::temp_dir().join(format!("sombra-client-test-{}.dpapi", std::process::id()));
        assert!(Remote::new(path.clone()).is_ok());
        assert!(Remote::new(path).is_ok());
    }
    #[test]
    fn session_cookie_login_logout() {
        assert_eq!(session_cookie("mines_session=abc; Secure; HttpOnly"), Some("mines_session=abc".into()));
        assert_eq!(session_cookie("mines_session=; Max-Age=0"), Some("mines_session=".into()));
        assert_eq!(session_cookie("other=abc"), None);
    }
}
