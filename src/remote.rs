use crate::backend::diagnostics::{
    desktop_runtime_category, operation, Event, MAX_EVENTS, REPORT_BATCH,
};
use crate::diagnostic_file::Sink;
use serde_json::{json, Value};
#[cfg(test)]
use std::fs;
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
const API: &str = "https://sombra.mi-nerva.ru/api";
const SESSION_CHANGED: &str = "Сессия изменилась. Повторите запрос.";

#[derive(Default)]
struct DesktopDiagnostics {
    pending: VecDeque<Event>,
    uploading: bool,
    retry_at: Option<Instant>,
}

pub struct Remote {
    #[cfg(test)]
    endpoint: String,
    client: reqwest::Client,
    cookie: Mutex<String>,
    path: PathBuf,
    diagnostics: Arc<Mutex<DesktopDiagnostics>>,
    diagnostic_file: Sink,
    cache: Mutex<crate::attachment_cache::Cache>,
    requests: tokio::sync::Mutex<()>,
    generation: std::sync::atomic::AtomicU64,
}

impl Remote {
    pub fn new(path: PathBuf) -> Result<Self, reqwest::Error> {
        // reqwest uses rustls-no-provider; install one before constructing any client.
        // A previously installed provider is valid too (including repeated initialization).
        let _ = rustls::crypto::ring::default_provider().install_default();
        Ok(Self {
            #[cfg(test)]
            endpoint: API.into(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            cookie: Mutex::new(crate::session_storage::load(&path)),
            cache: Mutex::new(crate::attachment_cache::Cache::new(
                path.parent()
                    .unwrap_or(Path::new("."))
                    .join("attachment-cache"),
            )),
            requests: tokio::sync::Mutex::new(()),
            generation: std::sync::atomic::AtomicU64::new(0),
            diagnostic_file: Sink::start(path.parent().unwrap_or(Path::new(".")).to_path_buf()),
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
        self.diagnostic_file.record(&event);
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            // Keep ordinary HTTP rejections local; the server already sees its own status.
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
            Ok(cookie)
                if cookie.starts_with("mines_session=") && cookie.as_str() != "mines_session=" =>
            {
                cookie.clone()
            }
            _ => return,
        };
        let Ok(mut diagnostics) = self.diagnostics.lock() else {
            return;
        };
        if diagnostics.uploading
            || diagnostics.pending.is_empty()
            || diagnostics
                .retry_at
                .is_some_and(|retry| retry > Instant::now())
        {
            return;
        }
        diagnostics.uploading = true;
        let count = REPORT_BATCH.min(diagnostics.pending.len());
        let events: Vec<_> = diagnostics.pending.drain(..count).collect();
        let pending = Arc::clone(&self.diagnostics);
        let client = self.client.clone();
        #[cfg(test)]
        let endpoint = self.endpoint.clone();
        #[cfg(not(test))]
        let endpoint = API;
        tauri::async_runtime::spawn(async move {
            let response = client
                .post(endpoint)
                .timeout(Duration::from_secs(5))
                .header(reqwest::header::COOKIE, cookie)
                .json(&json!({"op": "diagnostics_report", "events": events}))
                .send()
                .await;
            if let Ok(mut diagnostics) = pending.lock() {
                diagnostics.uploading = false;
                let retry_in = match response {
                    Ok(response) if response.status().is_success() => return,
                    Ok(response) if response.status() == reqwest::StatusCode::BAD_REQUEST => {
                        Duration::from_secs(60)
                    }
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

impl Remote {
    async fn http(&self, mut request: Value) -> Result<Value, String> {
        if let Some(object) = request.as_object_mut() {
            object.remove("token");
        }
        let generation = self.generation.load(std::sync::atomic::Ordering::SeqCst);
        let op = operation(request["op"].as_str().unwrap_or_default());
        let cookie = self
            .cookie
            .lock()
            .map_err(|_| {
                self.record_failure(op, "session_storage", None);
                "Session unavailable"
            })?
            .clone();
        #[cfg(test)]
        let endpoint = self.endpoint.as_str();
        #[cfg(not(test))]
        let endpoint = API;
        let mut outgoing = self.client.post(endpoint).json(&request);
        if !cookie.is_empty() {
            outgoing = outgoing.header(reqwest::header::COOKIE, cookie);
        }
        if op == "voice_poll" {
            outgoing = outgoing.timeout(Duration::from_secs(5));
        }
        if op == "attachment_file" || (op == "message" && request.get("attachment").is_some()) {
            outgoing = outgoing.timeout(Duration::from_secs(90));
        }
        let response = outgoing.send().await.map_err(|error| {
        self.record_failure(op, if error.is_timeout() { "timeout" } else { "transport" }, None);
        "REMOTE_UNAVAILABLE:Не удалось связаться с сервером Sombra. Проверьте подключение и повторите попытку."
    })?;
        if generation != self.generation.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(SESSION_CHANGED.into());
        }
        let status = response.status();
        let record_failure = |category| self.record_failure(op, category, Some(status.as_u16()));
        if !status.is_success() {
            record_failure("http_error");
        }
        {
            let mut cache = self.cache.lock().map_err(|_| "Cache unavailable")?;
            if generation != self.generation.load(std::sync::atomic::Ordering::SeqCst) {
                return Err(SESSION_CHANGED.into());
            }
            for value in response.headers().get_all(reqwest::header::SET_COOKIE) {
                if let Some(cookie) = value.to_str().ok().and_then(session_cookie) {
                    crate::session_storage::save(&self.path, &cookie)
                        .inspect_err(|_| record_failure("session_storage"))?;
                    if cookie == "mines_session=" || cookie.is_empty() {
                        cache.invalidate();
                    }
                    *self.cookie.lock().map_err(|_| {
                        record_failure("session_storage");
                        "Session unavailable"
                    })? = cookie;
                }
            }
            if status == reqwest::StatusCode::FORBIDDEN {
                cache.invalidate();
            }
            if status == reqwest::StatusCode::UNAUTHORIZED {
                cache.invalidate();
                self.generation
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                self.cookie
                    .lock()
                    .map_err(|_| {
                        record_failure("session_storage");
                        "Session unavailable"
                    })?
                    .clear();
                crate::session_storage::save(&self.path, "")
                    .inspect_err(|_| record_failure("session_storage"))?;
                return Err("AUTH_REQUIRED".into());
            }
        }
        if op == "voice_poll" && status.is_server_error() {
            return Err(format!(
                "REMOTE_UNAVAILABLE:Сервер временно недоступен ({status})"
            ));
        }
        let body: Value = response.json().await.map_err(|error| {
            record_failure(if error.is_timeout() {
                "timeout"
            } else {
                "invalid_response"
            });
            if error.is_timeout() {
                "REMOTE_UNAVAILABLE:Сервер Sombra слишком долго отвечает."
            } else {
                "Некорректный ответ сервера Sombra"
            }
        })?;
        if generation != self.generation.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(SESSION_CHANGED.into());
        }
        if let Some(error) = body.get("error").and_then(Value::as_str) {
            // A backend visibility denial may be HTTP 400, not only 401/403.
            // Revoke the accepted snapshot on any attachment rejection except TTL expiry.
            if op == "attachment_file"
                && error != "ATTACHMENT_EXPIRED"
                && error != "Срок хранения вложения истёк: файл больше недоступен"
            {
                let mut cache = self.cache.lock().map_err(|_| "Cache unavailable")?;
                if generation != self.generation.load(std::sync::atomic::Ordering::SeqCst) {
                    return Err(SESSION_CHANGED.into());
                }
                cache.invalidate();
            }
            if error == "AUTH_REQUIRED" {
                let mut cache = self.cache.lock().map_err(|_| "Cache unavailable")?;
                if generation != self.generation.load(std::sync::atomic::Ordering::SeqCst) {
                    return Err(SESSION_CHANGED.into());
                }
                cache.invalidate();
                self.generation
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                self.cookie
                    .lock()
                    .map_err(|_| "Session unavailable")?
                    .clear();
                let _ = crate::session_storage::save(&self.path, "");
            }
            return Err(error.into());
        }
        if !status.is_success() {
            return Err(format!("Сервер временно недоступен ({status})"));
        }
        let data = body.get("data").cloned().ok_or_else(|| {
            record_failure("invalid_response");
            "Некорректный ответ сервера Sombra"
        })?;
        self.flush_diagnostics();
        Ok(data)
    }
}
impl Remote {
    async fn ensure_storage_scope(&self) -> Result<(), String> {
        {
            let cache = self.cache.lock().map_err(|_| "Cache unavailable")?;
            let cookie = self.cookie.lock().map_err(|_| "Session unavailable")?;
            if cache.account.is_some() && !cookie.is_empty() && cookie.as_str() != "mines_session="
            {
                return Ok(());
            }
        }
        let _order = self.requests.lock().await;
        self.ensure_cache_scope().await
    }
    async fn ensure_cache_scope(&self) -> Result<(), String> {
        if self.cache.lock().map_err(|_| "Cache unavailable")?.fresh() {
            return Ok(());
        }
        let generation = self.generation.load(std::sync::atomic::Ordering::SeqCst);
        let revision = self
            .cache
            .lock()
            .map_err(|_| "Cache unavailable")?
            .scope_revision;
        let data = self.http(json!({"op":"state"})).await?;
        let mut cache = self.cache.lock().map_err(|_| "Cache unavailable")?;
        if generation != self.generation.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(SESSION_CHANGED.into());
        }
        if cache.scope_revision != revision {
            return Err("REMOTE_UNAVAILABLE:Состояние изменилось. Повторите запрос.".into());
        }
        if !cache.accept(&data) {
            return Err("AUTH_REQUIRED".into());
        }
        Ok(())
    }
    async fn request(&self, request: Value) -> Result<Value, String> {
        let op = request["op"].as_str().unwrap_or_default().to_owned();
        if matches!(
            op.as_str(),
            "logout" | "logout_all" | "change_password" | "login" | "register"
        ) {
            let mut cache = self.cache.lock().map_err(|_| "Cache unavailable")?;
            cache.invalidate();
            self.generation
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        let generation = self.generation.load(std::sync::atomic::Ordering::SeqCst);
        let mut order = if matches!(
            op.as_str(),
            "state"
                | "attachment_file"
                | "logout"
                | "logout_all"
                | "change_password"
                | "login"
                | "register"
        ) {
            Some(self.requests.lock().await)
        } else {
            None
        };
        if generation != self.generation.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(SESSION_CHANGED.into());
        }
        let message = request["message"].as_str().unwrap_or_default().to_owned();
        let mut expected_attachment = None;
        let revision = if op == "attachment_file" {
            self.ensure_cache_scope().await?;
            let mut cache = self.cache.lock().map_err(|_| "Cache unavailable")?;
            if !cache.visible.contains_key(&message) {
                return Err("Сообщение не найдено".into());
            }
            if let Some(payload) = cache.read(&message) {
                return Ok(payload);
            }
            expected_attachment = cache.visible.get(&message).cloned();
            cache.revision
        } else {
            0
        };
        let state_revision = self
            .cache
            .lock()
            .map_err(|_| "Cache unavailable")?
            .scope_revision;
        // Large files must not hold up state polls, chat refreshes or logout.
        if op == "attachment_file" {
            drop(order.take());
        }
        let result = self.http(request).await;
        if op == "attachment_file" {
            order = Some(self.requests.lock().await);
            {
                let _scope = self.cache.lock().map_err(|_| "Cache unavailable")?;
                let current_generation = self.generation.load(std::sync::atomic::Ordering::SeqCst);
                if generation != current_generation {
                    // A current 401 invalidates its own generation. Preserve that authentication
                    // failure, but never attribute an older account's failure to a newer session.
                    if current_generation == generation.wrapping_add(1)
                        && result.as_ref().is_err_and(|error| error == "AUTH_REQUIRED")
                        && self
                            .cookie
                            .lock()
                            .map_err(|_| "Session unavailable")?
                            .is_empty()
                    {
                        return result;
                    }
                    return Err(SESSION_CHANGED.into());
                }
            }
            // A successful payload is not authorization: revalidate after the transfer.
            if result.is_ok() {
                self.ensure_cache_scope().await?;
            }
        }
        if matches!(op.as_str(), "logout" | "logout_all") {
            let mut cache = self.cache.lock().map_err(|_| "Cache unavailable")?;
            if generation == self.generation.load(std::sync::atomic::Ordering::SeqCst) {
                cache.invalidate();
                self.cookie
                    .lock()
                    .map_err(|_| "Session unavailable")?
                    .clear();
                let _ = crate::session_storage::save(&self.path, "");
            }
        }
        let mut data = result?;
        let mut cache = self.cache.lock().map_err(|_| "Cache unavailable")?;
        if generation != self.generation.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(SESSION_CHANGED.into());
        }
        if op == "state" {
            if cache.scope_revision != state_revision {
                return Err("REMOTE_UNAVAILABLE:Состояние изменилось. Повторите запрос.".into());
            }
            if !cache.accept(&data) {
                return Err("AUTH_REQUIRED".into());
            }
            cache.decorate(&mut data);
        } else if op == "attachment_file" {
            let authorized = expected_attachment
                .as_ref()
                .zip(cache.visible.get(&message))
                .is_some_and(|(before, current)| {
                    crate::attachment_cache::Cache::same_attachment(before, current)
                });
            if !authorized {
                return Err("Сообщение не найдено".into());
            }
            if !cache.valid(&message, &data) {
                return Err("Некорректное вложение".into());
            }
            cache.write(&message, &data, revision);
        }
        drop(order);
        Ok(data)
    }
}
#[tauri::command]
pub async fn remote_api(
    state: tauri::State<'_, Remote>,
    mut request: Value,
) -> Result<Value, String> {
    if let Some(object) = request.as_object_mut() {
        object.remove("token");
    }
    state.request(request).await
}
#[tauri::command]
pub async fn attachment_cache_info(state: tauri::State<'_, Remote>) -> Result<Value, String> {
    state.ensure_storage_scope().await?;
    Ok(state.cache.lock().map_err(|_| "Cache unavailable")?.info())
}
#[tauri::command]
pub async fn set_attachment_cache_limit(
    state: tauri::State<'_, Remote>,
    limit_mi_b: u32,
) -> Result<Value, String> {
    state.ensure_storage_scope().await?;
    state
        .cache
        .lock()
        .map_err(|_| "Cache unavailable")?
        .set_limit(limit_mi_b)
}
#[tauri::command]
pub async fn clear_attachment_cache(state: tauri::State<'_, Remote>) -> Result<Value, String> {
    // Invalidate in-flight writes before waiting for any HTTP request.
    {
        state.cache.lock().map_err(|_| "Cache unavailable")?.clear();
    }
    state.ensure_storage_scope().await?;
    let mut cache = state.cache.lock().map_err(|_| "Cache unavailable")?;
    cache.clear();
    Ok(cache.info())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[cfg(windows)]
    async fn native_profile_decoration_round_trips_through_real_api_and_stored_session() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let backend = crate::backend::Backend::open(root.join("server/db.json")).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/api", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, crate::backend::api_router(backend))
                .await
                .unwrap()
        });
        let session_path = root.join("desktop/session.dpapi");
        let mut remote = Remote::new(session_path.clone()).unwrap();
        remote.endpoint = endpoint.clone();
        remote.request(json!({"op":"register","email":"native-profile@local.test","name":"Native profile","password":"Synthetic-Profile-123!"})).await.unwrap();
        let avatar = json!({"v":1,"target":"avatar","seed":19,"layers":[{"effect":"holy/divine-shield","palette":"ember","anchor":"ring","intensity":0.9}]});
        let saved = remote.request(json!({"op":"set_profile_decoration","token":"stale-webview-token","target":"avatar","decoration":avatar})).await.unwrap();
        assert_eq!(saved["user"]["decorations"]["avatar"], avatar);
        drop(remote);
        let mut remote = Remote::new(session_path).unwrap();
        remote.endpoint = endpoint;
        let state = remote.request(json!({"op":"state"})).await.unwrap();
        assert_eq!(state["me"]["decorations"]["avatar"], avatar);
        let public = state["users"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["id"] == state["me"]["id"])
            .unwrap();
        assert_eq!(public["decorations"]["avatar"], avatar);
        let removed = remote
            .request(json!({"op":"set_profile_decoration","target":"avatar","decoration":null}))
            .await
            .unwrap();
        assert!(removed["user"].get("decorations").is_none());
        server.abort();
        let _ = server.await;
        let _ = fs::remove_dir_all(root);
    }
    #[tokio::test]
    #[cfg(windows)]
    async fn attachment_cache_late_state_cannot_resurrect_revoked_scope() {
        let started = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let (s, r) = (started.clone(), release.clone());
        let app = axum::Router::new().route(
            "/",
            axum::routing::post(move || {
                let (s, r) = (s.clone(), r.clone());
                async move {
                    s.notify_one();
                    r.notified().await;
                    axum::Json(json!({"data":{"me":{"id":"account"},"messages":[]}}))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let mut remote = Remote::new(root.join("session.dpapi")).unwrap();
        remote.endpoint = format!("http://{address}/");
        *remote.cookie.lock().unwrap() = "mines_session=test".into();
        let remote = Arc::new(remote);
        remote
            .cache
            .lock()
            .unwrap()
            .accept(&json!({"me":{"id":"account"},"messages":[]}));
        let r = remote.clone();
        let pending = tokio::spawn(async move { r.request(json!({"op":"state"})).await });
        started.notified().await;
        {
            let mut cache = remote.cache.lock().unwrap();
            cache.clear();
            cache.set_limit(0).unwrap();
        }
        release.notify_one();
        pending
            .await
            .unwrap()
            .expect("clear/disable must not invalidate state authorization");
        assert!(remote.cache.lock().unwrap().account.is_some());
        let r = remote.clone();
        let pending = tokio::spawn(async move { r.request(json!({"op":"state"})).await });
        started.notified().await;
        remote.cache.lock().unwrap().invalidate();
        release.notify_one();
        assert!(pending
            .await
            .unwrap()
            .unwrap_err()
            .starts_with("REMOTE_UNAVAILABLE:"));
        assert!(remote.cache.lock().unwrap().account.is_none());
        server.abort();
        let _ = server.await;
        let _ = fs::remove_dir_all(root);
    }
    #[tokio::test]
    #[cfg(windows)]
    async fn attachment_cache_transfers_do_not_block_state_and_recheck_revocation() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let visible = Arc::new(AtomicBool::new(true));
        let account_b = Arc::new(AtomicBool::new(false));
        let server_account_b = account_b.clone();
        let started = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let (server_visible, server_started, server_release) =
            (visible.clone(), started.clone(), release.clone());
        let app=axum::Router::new().route("/",axum::routing::post(move |axum::Json(request):axum::Json<Value>| {
            let (visible,started,release,account_b)=(server_visible.clone(),server_started.clone(),server_release.clone(),server_account_b.clone());async move {
                let mut headers=axum::http::HeaderMap::new();
                let data=match request["op"].as_str().unwrap_or_default(){
                    "login"=>{account_b.store(true,Ordering::SeqCst);headers.insert(axum::http::header::SET_COOKIE,axum::http::HeaderValue::from_static("mines_session=account-b; HttpOnly"));json!({"user":{"id":"account-b"}})},
                    "state"=>json!({"me":{"id":if account_b.load(Ordering::SeqCst){"account-b"}else{"account"}},"messages":if visible.load(Ordering::SeqCst){json!([{"id":"m","attachment":{"id":"a","name":"x","mime":"application/octet-stream","size":1}}])}else{json!([])}}),
                    "attachment_file"=>{started.notify_one();release.notified().await;json!({"name":"x","mime":"application/octet-stream","data":"eA=="})},
                    _=>json!({})
                };(headers,axum::Json(json!({"data":data})))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let mut remote = Remote::new(root.join("session.dpapi")).unwrap();
        remote.endpoint = format!("http://{address}/");
        *remote.cookie.lock().unwrap() = "mines_session=test".into();
        let remote = Arc::new(remote);
        let file = json!({"op":"attachment_file","message":"m"});
        remote.request(json!({"op":"state"})).await.unwrap();
        let r = remote.clone();
        let request = file.clone();
        let transfer = tokio::spawn(async move { r.request(request).await });
        started.notified().await;
        tokio::time::timeout(
            Duration::from_secs(1),
            remote.request(json!({"op":"state"})),
        )
        .await
        .expect("state blocked by attachment HTTP")
        .unwrap();
        release.notify_one();
        transfer.await.unwrap().unwrap();
        assert_eq!(remote.request(file.clone()).await.unwrap()["cached"], true);
        remote.cache.lock().unwrap().clear();
        let r = remote.clone();
        let request = file.clone();
        let transfer = tokio::spawn(async move { r.request(request).await });
        started.notified().await;
        visible.store(false, Ordering::SeqCst);
        tokio::time::timeout(
            Duration::from_secs(1),
            remote.request(json!({"op":"state"})),
        )
        .await
        .unwrap()
        .unwrap();
        release.notify_one();
        assert!(transfer.await.unwrap().is_err());
        assert_eq!(remote.cache.lock().unwrap().info()["files"], 0);
        visible.store(true, Ordering::SeqCst);
        remote.request(json!({"op":"state"})).await.unwrap();
        let r = remote.clone();
        let transfer = tokio::spawn(async move { r.request(file).await });
        started.notified().await;
        tokio::time::timeout(
            Duration::from_secs(1),
            remote.request(json!({"op":"logout"})),
        )
        .await
        .expect("logout blocked by attachment HTTP")
        .unwrap();
        assert!(remote.cache.lock().unwrap().account.is_none());
        remote.request(json!({"op":"login"})).await.unwrap();
        remote.request(json!({"op":"state"})).await.unwrap();
        assert_eq!(
            remote.cookie.lock().unwrap().as_str(),
            "mines_session=account-b"
        );
        assert_eq!(
            remote.cache.lock().unwrap().account.as_deref(),
            Some("account-b")
        );
        release.notify_one();
        assert_eq!(transfer.await.unwrap().unwrap_err(), SESSION_CHANGED);
        assert_eq!(
            remote.cookie.lock().unwrap().as_str(),
            "mines_session=account-b"
        );
        assert_eq!(
            remote.cache.lock().unwrap().account.as_deref(),
            Some("account-b")
        );
        assert_eq!(
            remote.request(json!({"op":"state"})).await.unwrap()["me"]["id"],
            "account-b"
        );
        server.abort();
        let _ = server.await;
        let _ = fs::remove_dir_all(root);
    }
    #[tokio::test]
    #[cfg(windows)]
    async fn attachment_cache_native_http_auth_visibility_and_stale_failure() {
        use std::sync::atomic::{AtomicU32, Ordering};
        let mode = Arc::new(AtomicU32::new(0));
        let calls = Arc::new(AtomicU32::new(0));
        let state_calls = Arc::new(AtomicU32::new(0));
        let server_state_calls = state_calls.clone();
        let server_mode = mode.clone();
        let server_calls = calls.clone();
        let app=axum::Router::new().route("/",axum::routing::post(move |axum::Json(request):axum::Json<Value>| {
            let mode=server_mode.clone();let calls=server_calls.clone();let state_calls=server_state_calls.clone();async move {
                let current=mode.load(Ordering::SeqCst);
                if current==1 {return (axum::http::StatusCode::UNAUTHORIZED,axum::Json(json!({"error":"AUTH_REQUIRED"})));}
                let data=if request["op"]=="state" {state_calls.fetch_add(1,Ordering::SeqCst);json!({"me":{"id":"native-account"},"messages":if current==3 {json!([])} else {json!([{"id":"m","attachment":{"id":"a","name":"x","size":1,"mime":"application/octet-stream","expired":true}},{"id":"b","attachment":{"id":"b-attachment","name":"x","size":1,"mime":"application/octet-stream"}}])}})}else {
                    calls.fetch_add(1,Ordering::SeqCst);
                    if current==5 {return (axum::http::StatusCode::BAD_REQUEST,axum::Json(json!({"error":"ATTACHMENT_EXPIRED"})));}
                    if current==4 {return (axum::http::StatusCode::BAD_REQUEST,axum::Json(json!({"error":"Сообщение не найдено"})));}
                    if current==2 {return (axum::http::StatusCode::FORBIDDEN,axum::Json(json!({"error":"Forbidden"})));}
                    json!({"name":"x","mime":"application/octet-stream","data":"eA=="})
                };(axum::http::StatusCode::OK,axum::Json(json!({"data":data})))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let mut remote = Remote::new(root.join("session.dpapi")).unwrap();
        remote.endpoint = format!("http://{address}/");
        *remote.cookie.lock().unwrap() = "mines_session=test-only".into();
        let request =
            json!({"op":"attachment_file","message":"m","cached":true,"account":"untrusted"});
        assert!(remote
            .request(request.clone())
            .await
            .unwrap()
            .get("cached")
            .is_none());
        assert_eq!(
            remote.request(request.clone()).await.unwrap()["cached"],
            true
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(state_calls.load(Ordering::SeqCst), 1);
        // Simultaneous views reuse the already accepted native snapshot, not a JS hint.
        let (first, second) = tokio::join!(
            remote.request(request.clone()),
            remote.request(request.clone())
        );
        assert_eq!(first.unwrap()["cached"], true);
        assert_eq!(second.unwrap()["cached"], true);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(state_calls.load(Ordering::SeqCst), 1);
        // Even concurrent stale hits require exactly one refresh under the request gate.
        remote.cache.lock().unwrap().accepted = Some(Instant::now() - Duration::from_secs(6));
        let (first, second) = tokio::join!(
            remote.request(request.clone()),
            remote.request(request.clone())
        );
        assert_eq!(first.unwrap()["cached"], true);
        assert_eq!(second.unwrap()["cached"], true);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(state_calls.load(Ordering::SeqCst), 2);
        // A cache miss's HTTP-400 visibility denial must revoke other cached entries.
        mode.store(5, Ordering::SeqCst);
        assert_eq!(
            remote
                .request(json!({"op":"attachment_file","message":"b"}))
                .await
                .unwrap_err(),
            "ATTACHMENT_EXPIRED"
        );
        assert!(remote.cache.lock().unwrap().account.is_some());
        assert_eq!(
            remote.request(request.clone()).await.unwrap()["cached"],
            true
        );
        mode.store(4, Ordering::SeqCst);
        assert_eq!(
            remote
                .request(json!({"op":"attachment_file","message":"b"}))
                .await
                .unwrap_err(),
            "Сообщение не найдено"
        );
        assert!(remote.cache.lock().unwrap().account.is_none());
        mode.store(3, Ordering::SeqCst);
        // No JS state poll: native file access must revalidate and see the hidden snapshot.
        assert!(remote.request(request.clone()).await.is_err());
        assert!(remote.request(request.clone()).await.is_err());
        assert_eq!(remote.cache.lock().unwrap().info()["files"], 0);
        mode.store(0, Ordering::SeqCst);
        remote.request(json!({"op":"state"})).await.unwrap();
        mode.store(2, Ordering::SeqCst);
        assert_eq!(
            remote.request(request.clone()).await.unwrap_err(),
            "Forbidden"
        );
        assert!(remote.cache.lock().unwrap().account.is_none());
        mode.store(0, Ordering::SeqCst);
        remote.request(request.clone()).await.unwrap();
        mode.store(1, Ordering::SeqCst);
        assert_eq!(
            remote
                .request(json!({"op":"attachment_file","message":"b"}))
                .await
                .unwrap_err(),
            "AUTH_REQUIRED"
        );
        assert!(remote.cookie.lock().unwrap().is_empty());
        *remote.cookie.lock().unwrap() = "mines_session=test-only".into();
        mode.store(0, Ordering::SeqCst);
        remote.request(json!({"op":"state"})).await.unwrap();
        remote.cache.lock().unwrap().accepted = Some(Instant::now() - Duration::from_secs(6));
        mode.store(1, Ordering::SeqCst);
        assert_eq!(
            remote.request(request.clone()).await.unwrap_err(),
            "AUTH_REQUIRED"
        );
        assert!(remote.cookie.lock().unwrap().is_empty());
        assert!(remote.cache.lock().unwrap().account.is_none());
        *remote.cookie.lock().unwrap() = "mines_session=test-only".into();
        mode.store(0, Ordering::SeqCst);
        remote.request(json!({"op":"state"})).await.unwrap();
        remote.cache.lock().unwrap().accepted = Some(Instant::now() - Duration::from_secs(6));
        server.abort();
        let _ = server.await;
        assert!(remote
            .request(request)
            .await
            .unwrap_err()
            .starts_with("REMOTE_UNAVAILABLE:"));
        let _ = fs::remove_dir_all(root);
    }
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
            let last: Value =
                serde_json::from_str(std::str::from_utf8(&bytes).unwrap().lines().last().unwrap())
                    .unwrap();
            assert_eq!(last["operation"], "unknown");
            assert_eq!(last["category"], "transport");
            assert!(!String::from_utf8(bytes)
                .unwrap()
                .contains("private-operation-value"));
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn remote_client_starts_without_prior_tls_initialization() {
        let directory = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let path = directory.join("session.dpapi");
        assert!(Remote::new(path.clone()).is_ok());
        assert!(Remote::new(path).is_ok());
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn session_cookie_login_logout() {
        assert_eq!(
            session_cookie("mines_session=abc; Secure; HttpOnly"),
            Some("mines_session=abc".into())
        );
        assert_eq!(
            session_cookie("mines_session=; Max-Age=0"),
            Some("mines_session=".into())
        );
        assert_eq!(session_cookie("other=abc"), None);
    }
}
