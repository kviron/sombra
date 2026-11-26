//! Message attachments are private, independently expirable files, never database payloads.
//! External cleanup may delete files older than 30 days; metadata remains in message history.
use super::*;
use base64::engine::general_purpose::STANDARD;
use std::io::{Read, Write};

const MAX_BYTES: usize = 10 * 1024 * 1024;
const MAX_ENCODED: usize = MAX_BYTES.div_ceil(3) * 4;
const MAX_ATTACHMENTS: usize = 10;
const STAGING_TTL: u64 = 3600;
const MAX_PENDING_PER_USER: usize = 40;
const MAX_PENDING_TOTAL: usize = 256;
const INVALID: &str = "MESSAGE_ATTACHMENTS_INVALID";
const UNAVAILABLE: &str = "MESSAGE_ATTACHMENTS_UNAVAILABLE";
const EXPIRED: &str = "Срок хранения вложения истёк: файл больше недоступен";

pub(super) fn message_attachments(message: &Value) -> &[Value] {
    match message["attachments"].as_array() {
        Some(items) => items,
        None if message["attachment"].is_object() => std::slice::from_ref(&message["attachment"]),
        None => &[],
    }
}

pub(super) fn selected_attachment<'a>(message: &'a Value, id: Option<&Value>) -> Option<&'a Value> {
    let items = message_attachments(message);
    match id {
        None => items.first(),
        Some(id) => items
            .iter()
            .find(|item| id.is_string() && item["id"] == *id),
    }
}

pub(super) fn attachment_ids(request: &Value) -> Result<Option<Vec<&str>>, String> {
    if request.get("attachments").is_some() || request.get("attachment_id").is_some() {
        return Err(INVALID.into());
    }
    let Some(ids) = request.get("attachment_ids") else {
        return Ok(None);
    };
    if request.as_object().unwrap().keys().any(|k| {
        !matches!(
            k.as_str(),
            "op" | "token"
                | "bot_token"
                | "channel"
                | "text"
                | "mentions"
                | "replyTo"
                | "attachment_ids"
        )
    }) || request.get("text").is_some_and(|t| !t.is_string())
        || request.get("replyTo").is_some_and(|id| id.as_str().is_none_or(str::is_empty))
        || request.get("mentions").is_some_and(|mentions| !mentions.is_array())
    {
        return Err(INVALID.into());
    }
    let ids = ids
        .as_array()
        .filter(|ids| (1..=MAX_ATTACHMENTS).contains(&ids.len()))
        .ok_or(INVALID)?;
    let mut unique = Vec::with_capacity(ids.len());
    for value in ids {
        let id = value.as_str().ok_or(INVALID)?;
        if uuid::Uuid::parse_str(id)
            .ok()
            .is_none_or(|uuid| uuid.to_string() != id)
            || unique.contains(&id)
        {
            return Err(INVALID.into());
        }
        unique.push(id);
    }
    Ok(Some(unique))
}

fn safe_name(name: &str) -> String {
    let leaf = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = leaf.chars().filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')).take(180).collect();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    if cleaned.is_empty() {
        "Вложение".into()
    } else {
        cleaned.into()
    }
}

fn sniff(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "application/octet-stream"
    }
}

// Read dimensions once on upload, including the orientation used by browsers for phone photos.
fn display_dimensions(bytes: &[u8], mime: &str) -> Option<(u32, u32)> {
    use image::{ImageDecoder, ImageFormat, ImageReader};
    let format = ImageFormat::from_mime_type(mime)?;
    let reader = ImageReader::with_format(std::io::Cursor::new(bytes), format);
    let mut decoder = reader.into_decoder().ok()?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 {
        return None;
    }
    let rotated = decoder
        .orientation()
        .is_ok_and(|orientation| orientation.to_exif() >= 5);
    Some(if rotated {
        (height, width)
    } else {
        (width, height)
    })
}

fn decode(value: &Value) -> Result<(String, Vec<u8>), String> {
    let object = value.as_object().ok_or("Некорректное вложение")?;
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .ok_or("Укажите имя вложения")?;
    let encoded = object
        .get("data")
        .and_then(Value::as_str)
        .ok_or("Некорректное вложение")?;
    if encoded.len() > MAX_ENCODED {
        return Err("Вложение: не более 10 МиБ".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Некорректный base64 вложения")?;
    if bytes.len() > MAX_BYTES {
        return Err("Вложение: не более 10 МиБ".into());
    }
    Ok((safe_name(name), bytes))
}

impl Backend {
    pub(super) fn upload_message_attachment(
        &mut self,
        v: &Value,
        uid: &str,
    ) -> Result<Value, String> {
        let channel = s(v, "channel");
        if !self.allowed(uid, channel) {
            return Err("Нет доступа к чату".into());
        }
        if v.as_object().unwrap().keys().any(|k| {
            !matches!(
                k.as_str(),
                "op" | "token" | "bot_token" | "channel" | "attachment"
            )
        }) || v["attachment"].as_object().is_none_or(|fields| {
            fields
                .keys()
                .any(|k| !matches!(k.as_str(), "name" | "data" | "mime"))
        }) || v["attachment"]
            .get("mime")
            .is_some_and(|mime| !mime.is_string())
        {
            return Err(INVALID.into());
        }
        let pending = self.db["pending_attachments"].as_object().unwrap();
        if pending.len() >= MAX_PENDING_TOTAL
            || pending.values().filter(|row| row["user"] == uid).count() >= MAX_PENDING_PER_USER
        {
            return Err("MESSAGE_ATTACHMENTS_LIMIT".into());
        }
        let attachment = self.store_attachment(&v["attachment"])?;
        let id = s(&attachment, "id");
        self.db["pending_attachments"][id] = json!({
            "user":uid, "channel":channel, "expires_at":now() + STAGING_TTL, "attachment":attachment
        });
        if let Err(error) = self.save() {
            let _ = std::fs::remove_file(self.attachment_path(&attachment).unwrap());
            return Err(error);
        }
        Ok(json!({"id": id}))
    }

    pub(super) fn previous_attachment_message(
        &self,
        uid: &str,
        channel: &str,
        ids: &[&str],
        hash: &str,
    ) -> Result<Option<&Value>, String> {
        if ids
            .iter()
            .all(|id| self.db["pending_attachments"].get(*id).is_some())
        {
            return Ok(None);
        }
        for message in self.db["messages"].as_array().unwrap().iter().rev() {
            if message["user"] != uid || message["channel"] != channel {
                continue;
            }
            let Some(items) = message["attachments"].as_array() else {
                continue;
            };
            let previous = items.iter().map(|item| s(item, "id"));
            if previous.clone().eq(ids.iter().copied())
                && message["attachment_request_hash"] == hash
            {
                return Ok(Some(message));
            }
            if previous.into_iter().any(|id| ids.contains(&id)) {
                return Err("MESSAGE_ATTACHMENTS_CONFLICT".into());
            }
        }
        Ok(None)
    }
    pub(super) fn staged_attachments(
        &self,
        ids: &[&str],
        uid: &str,
        channel: &str,
    ) -> Result<Vec<Value>, String> {
        let timestamp = now();
        ids.iter()
            .map(|&id| {
                let row = &self.db["pending_attachments"][id];
                let attachment = &row["attachment"];
                if row["user"] != uid
                    || row["channel"] != channel
                    || attachment["id"] != id
                    || row["expires_at"].as_u64().unwrap_or(0) <= timestamp
                    || self.attachment_expired(attachment)
                {
                    return Err(UNAVAILABLE.into());
                }
                Ok(attachment.clone())
            })
            .collect()
    }

    pub(super) fn cleanup_staged_attachments(&mut self, timestamp: u64) -> Result<(), String> {
        let mut removed = Vec::new();
        for (id, row) in self.db["pending_attachments"].as_object().unwrap() {
            if row["expires_at"].as_u64().unwrap_or(0) > timestamp {
                continue;
            }
            if let Some(path) = self.attachment_path(&row["attachment"]) {
                if let Err(error) = std::fs::remove_file(path) {
                    if error.kind() != std::io::ErrorKind::NotFound {
                        continue;
                    }
                }
            }
            removed.push((id.clone(), row.clone()));
        }
        if !removed.is_empty() {
            let pending = self.db["pending_attachments"].as_object_mut().unwrap();
            for (id, _) in &removed {
                pending.remove(id);
            }
            if let Err(error) = self.save() {
                self.db["pending_attachments"]
                    .as_object_mut()
                    .unwrap()
                    .extend(removed);
                return Err(error);
            }
        }
        Ok(())
    }

    pub(super) fn attachment_path(&self, attachment: &Value) -> Option<PathBuf> {
        let raw = attachment["id"].as_str()?;
        let uuid = uuid::Uuid::parse_str(raw).ok()?;
        if uuid.to_string() != raw {
            return None;
        }
        Some(self.path.with_file_name("message-attachments").join(raw))
    }

    pub(super) fn store_attachment(&self, value: &Value) -> Result<Value, String> {
        let (name, bytes) = decode(value)?;
        let mime = sniff(&bytes);
        let mut metadata = json!({"id":id(),"name":name,"size":bytes.len(),"mime":mime});
        if let Some((width, height)) = display_dimensions(&bytes, mime) {
            metadata["width"] = json!(width);
            metadata["height"] = json!(height);
        }
        let path = self
            .attachment_path(&metadata)
            .ok_or("STORAGE_UNAVAILABLE")?;
        let directory = path.parent().unwrap();
        std::fs::create_dir_all(directory).map_err(|_| "STORAGE_UNAVAILABLE")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| "STORAGE_UNAVAILABLE")?;
        }
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path).map_err(|_| "STORAGE_UNAVAILABLE")?;
        if file
            .write_all(&bytes)
            .and_then(|_| file.sync_all())
            .is_err()
        {
            drop(file);
            let _ = std::fs::remove_file(path);
            return Err("STORAGE_UNAVAILABLE".into());
        }
        Ok(metadata)
    }

    pub(super) fn attachment_file(&self, value: &Value) -> Result<Value, String> {
        let user = self.authenticate(s(value, "token"))?;
        let message = self.db["messages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|message| {
                message["id"] == value["message"] && self.message_visible(message, s(&user, "id"))
            })
            .ok_or("Сообщение не найдено")?;
        let metadata = selected_attachment(message, value.get("attachment_id"))
            .ok_or("Вложение не найдено")?;
        if value["metadata_only"].as_bool() == Some(true) {
            self.attachment_path(metadata)
                .ok_or("Вложение не найдено")?;
            return Ok(metadata.clone());
        }
        let bytes = self.attachment_bytes(metadata)?;
        let mut payload =
            json!({"data":STANDARD.encode(&bytes),"mime":sniff(&bytes),"name":metadata["name"]});
        if value["with_attachment_id"].as_bool() == Some(true) {
            payload["id"] = metadata["id"].clone();
        }
        Ok(payload)
    }

    pub(super) fn attachment_bytes(&self, metadata: &Value) -> Result<Vec<u8>, String> {
        let path = self
            .attachment_path(metadata)
            .ok_or("Вложение не найдено")?;
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(EXPIRED.into())
            }
            Err(_) => return Err("STORAGE_UNAVAILABLE".into()),
        };
        let mut bytes = Vec::new();
        file.take((MAX_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "STORAGE_UNAVAILABLE")?;
        if bytes.len() > MAX_BYTES || metadata["size"].as_u64() != Some(bytes.len() as u64) {
            return Err("STORAGE_UNAVAILABLE".into());
        }
        Ok(bytes)
    }

    pub(super) fn attachment_expired(&self, attachment: &Value) -> bool {
        self.attachment_path(attachment)
            .is_none_or(|path| !path.is_file())
    }
}

#[cfg(test)]
mod album_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn http_accepts_full_attachment_and_bounds_request_body() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut backend = Backend::open(path.clone()).unwrap();
        let owner = backend.db["users"][0].clone();
        let token = backend.token(&owner, "test", false).unwrap();
        let channel = backend.db["groups"][0]["channels"][0]["id"].clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/api", listener.local_addr().unwrap());
        let server =
            tokio::spawn(async move { axum::serve(listener, api_router(backend)).await.unwrap() });
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::new();
        let cookie = format!("mines_session={token}");
        let response = client
            .post(&url)
            .json(&json!({"op":"attachment_file","message":"unknown","token":token}))
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            401,
            "JSON token must not bypass cookie auth"
        );
        let payload = json!({"op":"upload_message_attachment","channel":channel,"attachment":{"name":"boundary.bin","data":STANDARD.encode(vec![0;MAX_BYTES])}});
        let mut ids = Vec::new();
        for _ in 0..2 {
            let response = client
                .post(&url)
                .header("cookie", &cookie)
                .json(&payload)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 200);
            let staged: Value = response.json().await.unwrap();
            ids.push(staged["data"]["id"].clone());
        }
        let response = client
            .post(&url)
            .header("cookie", &cookie)
            .json(&json!({"op":"message","channel":channel,"attachment_ids":ids}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let response = client
            .post(&url)
            .header("cookie", &cookie)
            .json(&json!({"op":"state"}))
            .send()
            .await
            .unwrap();
        let state: Value = response.json().await.unwrap();
        let message = &state["data"]["messages"][0]["id"];
        for _ in 0..3 {
            let response = client
                .post(&url)
                .header("cookie", &cookie)
                .json(&json!({"op":"attachment_file","message":message}))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 200);
            assert_eq!(response.headers()["cache-control"], "no-store");
            let result: Value = response.json().await.unwrap();
            assert_eq!(result["data"]["mime"], "application/octet-stream");
            assert_eq!(result["data"]["data"].as_str().unwrap().len(), MAX_ENCODED);
        }
        let response = client
            .post(&url)
            .header("content-type", "application/json")
            .body(" ".repeat(15 * 1024 * 1024 + 1))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 413);
        server.abort();
        let _ = server.await;
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn photo_metadata_uses_uploaded_file_dimensions() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let backend = Backend::open(path.clone()).unwrap();
        let mut png = std::io::Cursor::new(Vec::new());
        image::RgbImage::new(3, 7)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let metadata = backend.store_attachment(&json!({"name":"a.png","data":STANDARD.encode(png.into_inner()),"width":7,"height":3})).unwrap();
        assert_eq!(
            (metadata["width"].as_u64(), metadata["height"].as_u64()),
            (Some(3), Some(7))
        );
        assert!(display_dimensions(b"broken", "image/jpeg").is_none());
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn decoding_boundaries_names_and_safe_mime() {
        let encoded = STANDARD.encode(vec![42; MAX_BYTES]);
        assert_eq!(encoded.len(), MAX_ENCODED);
        assert_eq!(
            decode(&json!({"name":"a","data":encoded})).unwrap().1.len(),
            MAX_BYTES
        );
        let too_big = STANDARD.encode(vec![42; MAX_BYTES + 1]);
        assert!(decode(&json!({"name":"a","data":too_big})).is_err());
        assert!(decode(&json!({"name":"a","data":"A".repeat(MAX_ENCODED+1)})).is_err());
        for bad in ["!!!!", "data:image/png;base64,AAAA", "YQ", "YW Jj", "AB=="] {
            assert!(decode(&json!({"name":"a","data":bad})).is_err(), "{bad}");
        }
        assert_eq!(
            safe_name("../../folder\\evil\r\n:name.html"),
            "evilname.html"
        );
        assert_eq!(safe_name(".."), "Вложение");
        for (bytes, mime) in [
            (b"GIF89a".as_slice(), "image/gif"),
            (b"GIF87a", "image/gif"),
            (b"\x89PNG\r\n\x1a\n", "image/png"),
            (b"\xff\xd8\xff", "image/jpeg"),
            (b"RIFF1234WEBP", "image/webp"),
            (b"<svg onload='x'>", "application/octet-stream"),
            (b"<html>", "application/octet-stream"),
        ] {
            assert_eq!(sniff(bytes), mime);
        }
    }

    #[test]
    fn file_access_requires_auth_visible_message_and_metadata_survives_cleanup() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let owner = b.db["users"][0].clone();
        let token = b.token(&owner, "test", false).unwrap();
        let group = b.db["groups"][0].clone();
        let channel = &group["channels"][0]["id"];
        // Create an outsider without expensive password hashing: the fixture still uses real sessions.
        let guest = json!({"id":id(),"name":"Guest","bio":"","created_at":now()});
        b.db["users"].as_array_mut().unwrap().push(guest.clone());
        let outsider = b.token(&guest, "test", false).unwrap();
        let encoded = STANDARD.encode(b"GIF89aunique-payload");
        let send = json!({"op":"message","token":token,"channel":channel,"attachment":{"name":"../../test.gif","data":encoded,"mime":"text/html"}});
        let mut denied = send.clone();
        denied["token"] = json!(outsider);
        assert!(b.request(denied).is_err());
        b.request(send).unwrap();
        let message = b.db["messages"][0].clone();
        let read = json!({"op":"attachment_file","token":token,"message":message["id"]});
        let mut identified = read.clone();
        identified["with_attachment_id"] = json!(true);
        assert_eq!(b.request(identified).unwrap()["id"], message["attachment"]["id"]);
        let mut details = read.clone();
        details["metadata_only"] = json!(true);
        let header = b.request(details.clone()).unwrap();
        assert_eq!(header["id"], message["attachment"]["id"]);
        assert!(header.get("data").is_none());
        details["token"] = json!(outsider);
        assert_eq!(b.request(details).unwrap_err(), "Сообщение не найдено");
        let mut unauth = read.clone();
        unauth["token"] = json!("");
        assert_eq!(b.request(unauth).unwrap_err(), "AUTH_REQUIRED");
        let mut cross = read.clone();
        cross["token"] = json!(outsider);
        assert_eq!(
            b.request(cross.clone()).unwrap_err(),
            "Сообщение не найдено"
        );
        b.request(json!({"op":"join_group","token":outsider,"invite":group["invite"]}))
            .unwrap();
        assert_eq!(
            b.request(cross.clone()).unwrap(),
            json!({"data":encoded,"mime":"image/gif","name":"test.gif"})
        );
        b.request(json!({"op":"delete_message","token":outsider,"message":message["id"]}))
            .unwrap();
        assert_eq!(b.request(cross).unwrap_err(), "Сообщение не найдено");
        let state = b.request(json!({"op":"state","token":token})).unwrap();
        let metadata = &state["messages"][0]["attachment"];
        assert_eq!(metadata["mime"], "image/gif");
        assert_eq!(metadata["size"], b"GIF89aunique-payload".len());
        assert_eq!(metadata["expired"], false);
        assert!(metadata["data"].is_null());
        assert!(!state.to_string().contains(&encoded));
        assert!(!std::fs::read_to_string(&path).unwrap().contains(&encoded));
        let file = b.attachment_path(metadata).unwrap();
        assert_eq!(
            file.file_name().unwrap().to_str().unwrap(),
            metadata["id"].as_str().unwrap()
        );
        assert_ne!(file.file_name().unwrap(), "test.gif");
        // This is the same deletion the external retention cron performs.
        std::fs::remove_file(&file).unwrap();
        assert_eq!(b.request(read).unwrap_err(), EXPIRED);
        drop(b);
        let mut b = Backend::open(path.clone()).unwrap();
        let state = b.request(json!({"op":"state","token":token})).unwrap();
        assert_eq!(state["messages"][0]["attachment"]["expired"], true);
        assert_eq!(state["messages"][0]["attachment"]["name"], "test.gif");
        drop(b);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
