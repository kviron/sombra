use serde_json::Value;
use std::sync::Mutex;
const API: &str = "https://sombra.mi-nerva.ru/api";
pub struct Remote { client: reqwest::Client, cookie: Mutex<String>, path: std::path::PathBuf }
impl Remote {
    pub fn new(path: std::path::PathBuf) -> Result<Self, reqwest::Error> {
        // reqwest uses rustls-no-provider; install one before constructing any client.
        // A previously installed provider is valid too (including repeated initialization).
        let _ = rustls::crypto::ring::default_provider().install_default();
        Ok(Self { client: reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none()).build()?, cookie: Mutex::new(crate::session_storage::load(&path)), path })
    }
}
fn session_cookie(header: &str) -> Option<String> {
    let pair = header.split(';').next()?.trim();
    pair.strip_prefix("mines_session=").map(|_| pair.to_owned())
}
#[tauri::command]
pub async fn remote_api(state: tauri::State<'_, Remote>, mut request: Value) -> Result<Value, String> {
    if let Some(object) = request.as_object_mut() { object.remove("token"); }
    let cookie = state.cookie.lock().map_err(|_| "Session unavailable")?.clone();
    let mut outgoing = state.client.post(API).json(&request);
    if !cookie.is_empty() { outgoing = outgoing.header(reqwest::header::COOKIE, cookie); }
    let response = outgoing.send().await.map_err(|_| "Не удалось связаться с сервером Sombra. Проверьте подключение и повторите попытку.")?;
    let status = response.status();
    for value in response.headers().get_all(reqwest::header::SET_COOKIE) {
        if let Some(cookie) = value.to_str().ok().and_then(session_cookie) {
            crate::session_storage::save(&state.path, &cookie)?;
            *state.cookie.lock().map_err(|_| "Session unavailable")? = cookie;
        }
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        state.cookie.lock().map_err(|_| "Session unavailable")?.clear();
        crate::session_storage::save(&state.path, "")?;
        return Err("AUTH_REQUIRED".into());
    }
    let body: Value = response.json().await.map_err(|_| "Некорректный ответ сервера Sombra")?;
    if let Some(error) = body.get("error").and_then(Value::as_str) { return Err(error.into()); }
    if !status.is_success() { return Err(format!("Сервер временно недоступен ({status})")); }
    body.get("data").cloned().ok_or_else(|| "Некорректный ответ сервера Sombra".into())
}
#[cfg(test)]
mod tests {
    use super::*;
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
