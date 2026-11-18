use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use ring::{digest, pbkdf2};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    num::NonZeroU32,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
mod attachments;
mod bot_decorations;
mod bot_management;
mod bot_model_settings;
mod bot_transport;
mod bots;
mod chat_preferences;
pub(crate) mod diagnostics;
mod dialog_calls;
mod dialog_metadata;
mod group_roles;
mod human_typing;
mod message_reads;
mod mentions;
mod music;
mod profile_covers;
mod profile_decorations;
mod profile_effect_drafts;
mod effect_catalog;
mod sticker_catalog;
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}
fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
fn arr(v: &Value) -> Vec<Value> {
    v.as_array().cloned().unwrap_or_default()
}
fn hash(password: &str, salt: &str) -> String {
    let mut out = [0u8; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(600_000).unwrap(),
        salt.as_bytes(),
        password.as_bytes(),
        &mut out,
    );
    B64.encode(out)
}
fn validate_avatar(avatar: &str) -> Result<(), String> {
    if avatar.is_empty() {
        return Ok(());
    }
    let (header, data) = avatar
        .split_once(',')
        .ok_or("Выберите корректное изображение для аватарки")?;
    if ![
        "data:image/png;base64",
        "data:image/jpeg;base64",
        "data:image/webp;base64",
    ]
    .contains(&header)
        || data.is_empty()
        || data.len() > 700_000
        || base64::engine::general_purpose::STANDARD
            .decode(data)
            .is_err()
    {
        return Err("Выберите изображение PNG, JPEG или WebP до 500 КБ".into());
    }
    Ok(())
}
fn validate_sticker(data: &str) -> Result<(), String> {
    let (prefix, encoded) = data.split_once(',').ok_or("Нужен PNG или WebP")?;
    if !["data:image/png;base64", "data:image/webp;base64"].contains(&prefix)
        || encoded.len() > 350000
    {
        return Err("Стикер: PNG или WebP до 256 КБ".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Некорректное изображение")?;
    let png = prefix == "data:image/png;base64" && bytes.starts_with(b"\x89PNG\r\n\x1a\n");
    let webp = prefix == "data:image/webp;base64"
        && bytes.starts_with(b"RIFF")
        && bytes.get(8..12) == Some(b"WEBP");
    if !png && !webp {
        return Err("Некорректное изображение".into());
    }
    Ok(())
}
#[derive(Serialize, Deserialize)]
struct UserDto {
    #[serde(rename = "coverSupported", default)]
    cover_supported: bool,
    #[serde(rename = "decorationSupported", default)]
    decoration_supported: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    cover: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    decorations: Option<Value>,
    #[serde(rename = "decorationRefs", skip_serializing_if = "Option::is_none", default)]
    decoration_refs: Option<Value>,
    #[serde(rename = "profileEffectAssets", skip_serializing_if = "Option::is_none", default)]
    profile_effect_assets: Option<Value>,
    id: String,
    name: String,
    bio: String,
    avatar: String,
    created_at: u64,
    online: bool,
    last_seen: u64,
    bot: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    commands: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active: Option<bool>,
}
const PRESENCE_TTL: u64 = 45;
#[derive(Serialize, Deserialize)]
struct UserRecord {
    id: String,
    name: String,
    email: String,
    salt: String,
    hash: String,
    bio: String,
    created_at: u64,
    version: u64,
}
#[derive(Deserialize)]
struct CredentialsDto {
    email: String,
    password: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    device: String,
    #[serde(default)]
    remember_me: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProfileDto {
    name: String,
    bio: String,
    #[serde(default)]
    avatar: Option<String>,
}
fn token_hash(token: &str) -> String {
    B64.encode(digest::digest(&digest::SHA256, token.as_bytes()).as_ref())
}
fn voice_ice_servers(
    static_servers: Value,
    turn_urls: Option<&str>,
    secret: Option<&str>,
    subject: &str,
    timestamp: u64,
) -> Value {
    let mut servers = static_servers.as_array().cloned().unwrap_or_default();
    let urls = turn_urls.and_then(|urls| serde_json::from_str::<Vec<String>>(urls).ok());
    if let (Some(urls), Some(secret)) = (urls, secret.filter(|secret| !secret.is_empty())) {
        if !urls.is_empty()
            && urls
                .iter()
                .all(|url| url.starts_with("turn:") || url.starts_with("turns:"))
        {
            // coturn REST credentials use an expiry in the username and HMAC-SHA1.
            let username = format!("{}:{subject}", timestamp + 12 * 60 * 60);
            let key =
                ring::hmac::Key::new(ring::hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY, secret.as_bytes());
            let mac = ring::hmac::sign(&key, username.as_bytes());
            let credential = base64::engine::general_purpose::STANDARD.encode(mac.as_ref());
            servers.push(json!({"urls":urls,"username":username,"credential":credential}));
        }
    }
    json!(servers)
}
const YEAR_SECONDS: u64 = 365 * 24 * 60 * 60;
fn session_lifetime(remember_me: bool) -> u64 {
    if remember_me {
        YEAR_SECONDS
    } else {
        2592000
    }
}
fn session_active(session: &Value, timestamp: u64) -> bool {
    session["expires_at"].as_u64().unwrap_or(0) > timestamp
        && (session["remember_me"].as_bool().unwrap_or(false)
            || session["last_seen"]
                .as_u64()
                .unwrap_or(0)
                .saturating_add(604800)
                > timestamp)
}
pub struct Backend {
    db: Value,
    path: PathBuf,
    failures: u32,
    retry_at: u64,
    voice: Vec<Value>,
    music: music::Music,
    signals: Vec<Value>,
    voice_seq: u64,
    dialog_calls: Vec<Value>,
    diagnostics: Arc<diagnostics::Diagnostics>,
    presence: std::collections::HashMap<String, u64>,
    bot_typing: Vec<Value>,
    human_typing: std::collections::HashMap<String, (String, u64)>,
    profile_effect_draft_bot_id: Option<String>,
}
impl Backend {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(path.parent().ok_or("Invalid path")?).map_err(|e| e.to_string())?;
        let db: Value = if path.exists() {
            serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("Database unreadable: {e}"))?
        } else {
            json!({"users":[],"groups":[],"dialogs":[],"messages":[],"secret":format!("{}{}",id(),id())})
        };
        if !["users", "groups", "dialogs", "messages"]
            .iter()
            .all(|k| db[*k].is_array())
            || s(&db, "secret").len() < 32
        {
            return Err("Invalid database; refusing to overwrite".into());
        }
        let music = music::Music::configured(path.parent().ok_or("Invalid path")?)?;
        let mut b = Self {
            db,
            path,
            failures: 0,
            retry_at: 0,
            voice: Vec::new(),
            music,
            signals: Vec::new(),
            voice_seq: 0,
            dialog_calls: Vec::new(),
            diagnostics: Arc::default(),
            presence: Default::default(),
            bot_typing: Vec::new(),
            human_typing: Default::default(),
            profile_effect_draft_bot_id: profile_effect_drafts::configured_bot(),
        };
        if b.db["sessions"].is_null() {
            b.db["sessions"] = json!([]);
        }
        if !b.db["sessions"].is_array() {
            return Err("Invalid sessions".into());
        }
        for key in ["stickers", "friends", "bots", "bot_updates"] {
            if b.db[key].is_null() {
                b.db[key] = json!([]);
            }
            if !b.db[key].is_array() {
                return Err("Invalid collection".into());
            }
        }
        b.db["schema_version"] = json!(3);
        for user in b.db["users"].as_array_mut().unwrap() {
            if user["created_at"].is_null() {
                user["created_at"] = json!(now());
                user["bio"] = json!("");
            }
        }
        for g in b.db["groups"].as_array_mut().unwrap() {
            if g["roles_revision"].as_u64().is_none() {
                g["roles_revision"] = json!(0);
            }
            if !g["member_invites"].is_boolean() {
                g["member_invites"] = json!(false);
            }
        }
        b.migrate_bots();
        b.open_profile_effect_drafts()?;
        b.save()?;
        if arr(&b.db["users"]).is_empty() {
            let password = format!("Mines-{}", &id()[..18]);
            let u = b.new_user("HollyWood", "owner@mines.local", &password);
            let uid = s(&u, "id").to_string();
            b.db["users"].as_array_mut().unwrap().push(u);
            let channels: Vec<_> = ["text", "id", "games", "help", "⚓ Команда 1", "Команда 2"]
                .iter()
                .enumerate()
                .map(|(i, n)| json!({"id":id(),"name":n,"kind":if i<4{"text"}else{"voice"}}))
                .collect();
            b.db["groups"].as_array_mut().unwrap().push(json!({"id":id(),"name":"LordDevil","owner":uid,"invite":id(),"roles_revision":0,"member_invites":false,"members":[uid],"channels":channels}));
            std::fs::write(
                b.path.with_file_name("FIRST-USER.txt"),
                format!("Email: owner@mines.local\nPassword: {password}\n"),
            )
            .map_err(|e| e.to_string())?;
            b.save()?;
        }
        Ok(b)
    }
    fn new_user(&self, name: &str, email: &str, password: &str) -> Value {
        let salt = id();
        serde_json::to_value(UserRecord {
            id: id(),
            name: name.into(),
            email: email.into(),
            hash: hash(password, &salt),
            salt,
            bio: String::new(),
            created_at: now(),
            version: 0,
        })
        .unwrap()
    }
    fn save(&mut self) -> Result<(), String> {
        self.normalize_read_sequences()?;
        let tmp = self.path.with_extension("tmp");
        let mut file = std::fs::File::create(&tmp).map_err(|_| "STORAGE_UNAVAILABLE")?;
        std::io::Write::write_all(
            &mut file,
            &serde_json::to_vec_pretty(&self.db).map_err(|_| "STORAGE_UNAVAILABLE")?,
        )
        .map_err(|_| "STORAGE_UNAVAILABLE")?;
        file.sync_all().map_err(|_| "STORAGE_UNAVAILABLE")?;
        std::fs::rename(&tmp, &self.path).map_err(|_| "STORAGE_UNAVAILABLE")?;
        #[cfg(unix)]
        if let Some(parent) = self.path.parent() {
            std::fs::File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| "STORAGE_UNAVAILABLE")?;
        }
        Ok(())
    }
    fn token(&mut self, u: &Value, device: &str, remember_me: bool) -> Result<String, String> {
        let token = format!("{}{}", id(), id());
        let timestamp = now();
        let sessions = self.db["sessions"].as_array_mut().unwrap();
        sessions.retain(|x| session_active(x, timestamp));
        sessions.push(json!({"id":id(),"user_id":u["id"],"token_hash":token_hash(&token),"device":device.chars().take(120).collect::<String>(),"created_at":timestamp,"last_seen":timestamp,"remember_me":remember_me,"expires_at":timestamp+session_lifetime(remember_me)}));
        self.save()?;
        Ok(token)
    }
    fn authenticate(&self, token: &str) -> Result<Value, String> {
        let session = arr(&self.db["sessions"])
            .into_iter()
            .find(|x| x["token_hash"] == token_hash(token) && session_active(x, now()))
            .ok_or("AUTH_REQUIRED")?;
        arr(&self.db["users"])
            .into_iter()
            .find(|u| u["id"] == session["user_id"] && u["bot"] != true)
            .ok_or("AUTH_REQUIRED".into())
    }
    fn touch_presence(&mut self, uid: &str) {
        let timestamp = now();
        self.presence.insert(uid.to_string(), timestamp);
        if self.presence.len() > 64 {
            self.presence
                .retain(|_, seen| timestamp.saturating_sub(*seen) < PRESENCE_TTL * 4);
        }
    }
    fn public(&self, u: &Value) -> Value {
        self.public_for(u, "")
    }
    fn public_for(&self, u: &Value, viewer: &str) -> Value {
        let bot = arr(&self.db["bots"])
            .into_iter()
            .find(|b| b["id"] == u["id"]);
        let last_seen = self.presence.get(s(u, "id")).copied().unwrap_or_else(|| {
            bot.as_ref()
                .and_then(|b| b["last_seen"].as_u64())
                .unwrap_or(0)
        });
        let decorations = profile_decorations::public(&u["decorations"]);
        let decoration_refs = decorations.as_ref().and_then(|d| self.effect_references(u, viewer, d));
        serde_json::to_value(UserDto {
            cover_supported: true,
            decoration_supported: true,
            cover: profile_covers::public_metadata(&u["profile_cover"]),
            decorations,
            decoration_refs,
            profile_effect_assets: self.profile_effect_assets(u),
            id: s(u, "id").into(),
            name: s(u, "name").into(),
            bio: s(u, "bio").into(),
            avatar: s(u, "avatar").into(),
            created_at: u["created_at"].as_u64().unwrap_or(0),
            online: last_seen > 0 && now().saturating_sub(last_seen) < PRESENCE_TTL,
            last_seen,
            bot: u["bot"] == true,
            username: u["username"].as_str().map(str::to_string),
            commands: bot.as_ref().map(|b| self.bot_commands(b)),
            enabled: bot.as_ref().map(|b| b["enabled"] != false),
            active: if u["bot"] == true {
                Some(
                    bot.as_ref()
                        .map_or(u["active"] != false, |b| b["enabled"] != false),
                )
            } else {
                None
            },
        })
        .unwrap()
    }
    fn allowed(&self, uid: &str, cid: &str) -> bool {
        arr(&self.db["groups"]).iter().any(|g| {
            arr(&g["members"]).contains(&json!(uid))
                && arr(&g["channels"]).iter().any(|c| c["id"] == cid)
        }) || arr(&self.db["dialogs"])
            .iter()
            .any(|d| d["id"] == cid && arr(&d["members"]).contains(&json!(uid)))
    }
    fn message_visible(&self, message: &Value, uid: &str) -> bool {
        self.allowed(uid, s(message, "channel"))
            && !message["hidden_by"]
                .as_array()
                .is_some_and(|users| users.iter().any(|user| user == uid))
    }
    fn public_message(&self, message: &Value) -> Value {
        let mut message = message.clone();
        if let Some(fields) = message.as_object_mut() {
            fields.remove("hidden_by");
            fields.remove("messageSeq");
        }
        if !message["mentions"].is_array() {
            message["mentions"] = json!([]);
        }
        if message["attachment"].is_object() {
            message["attachment"]["expired"] =
                json!(self.attachment_expired(&message["attachment"]));
        }
        message
    }
    fn voice_action(&mut self, v: &Value, uid: &str, session: &str) -> Result<Value, String> {
        self.cleanup_calls(now());
        self.signals
            .retain(|p| p["time"].as_u64().unwrap_or(0) + 30 > now());
        let op = s(v, "op");
        let client = s(v, "client");
        let room = s(v, "room");
        if client.len() < 16 || client.len() > 64 {
            return Err("Некорректное подключение".into());
        }
        let call_index = self.dialog_calls.iter().position(|c| c["id"] == room);
        let authorized = if let Some(index) = call_index {
            self.dialog_member(uid, s(&self.dialog_calls[index], "dialog"))
        } else {
            self.allowed(uid, room)
                && arr(&self.db["groups"]).iter().any(|g| {
                    arr(&g["channels"])
                        .iter()
                        .any(|c| c["id"] == room && c["kind"] == "voice")
                })
        };
        if !authorized {
            return Err("Нет доступа к голосовой комнате".into());
        }
        let owns = self
            .voice
            .iter()
            .any(|p| p["client"] == client && p["session"] == session && p["room"] == room);
        if op == "voice_join" {
            if self.voice.iter().any(|p| p["client"] == client && !owns) {
                return Err("Подключение уже используется".into());
            }
            let limit = if call_index.is_some() { 10 } else { 8 };
            if self.voice.iter().filter(|p| p["room"] == room).count() >= limit && !owns {
                return Err(format!("Комната заполнена ({limit} участников)"));
            }
            self.voice.retain(|p| p["client"] != client);
            self.voice.push(json!({"client":client,"user":uid,"session":session,"room":room,"seen":now(),"muted":false,"deaf":false}));
            if let Some(index) = call_index {
                self.dialog_calls[index]["declined"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|u| u != uid);
                self.dialog_calls[index]
                    .as_object_mut()
                    .unwrap()
                    .remove("empty_since");
            }
        } else if op == "voice_leave" {
            self.voice.retain(|p| {
                !(p["client"] == client && p["session"] == session && p["room"] == room)
            });
            self.cleanup_calls(now());
            return Ok(json!({}));
        } else if !owns {
            return Err("Соединение завершено. Войдите в комнату снова.".into());
        }
        if op == "voice_signal" {
            let target = s(v, "target");
            let payload = &v["payload"];
            if payload.to_string().len() > 65536
                || !self
                    .voice
                    .iter()
                    .any(|p| p["client"] == target && p["room"] == room)
            {
                return Err("Участник отключился".into());
            }
            if self.signals.iter().filter(|p| p["from"] == client).count() > 256 {
                return Err("Слишком много сигналов".into());
            }
            self.voice_seq += 1;
            self.signals.push(json!({"id":self.voice_seq,"from":client,"target":target,"payload":payload,"time":now()}));
            return Ok(json!({}));
        }
        if let Some(peer) = self
            .voice
            .iter_mut()
            .find(|p| p["client"] == client && p["session"] == session && p["room"] == room)
        {
            peer["seen"] = json!(now());
            if op == "voice_join" || op == "voice_poll" {
                for key in ["muted", "deaf"] {
                    if let Some(value) = v[key].as_bool() {
                        peer[key] = json!(value);
                    }
                }
            }
        }
        let after = v["after"].as_u64().unwrap_or(0);
        let peers:Vec<_>=self.voice.iter().filter(|p|p["room"]==room).map(|p|json!({"client":p["client"],"user":p["user"],"muted":p["muted"].as_bool().unwrap_or(false),"deaf":p["deaf"].as_bool().unwrap_or(false)})).collect();
        let signals: Vec<_> = self
            .signals
            .iter()
            .filter(|p| p["target"] == client && p["id"].as_u64().unwrap_or(0) > after)
            .cloned()
            .collect();
        let ice: Value = std::env::var("MINES_ICE_SERVERS")
            .ok()
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or(json!([]));
        let ice = if op == "voice_join" {
            voice_ice_servers(
                ice,
                std::env::var("MINES_TURN_URLS").ok().as_deref(),
                std::env::var("MINES_TURN_SECRET").ok().as_deref(),
                &token_hash(uid),
                now(),
            )
        } else {
            ice
        };
        Ok(json!({"peers":peers,"signals":signals,"cursor":self.voice_seq,"iceServers":ice}))
    }
    fn voice_presence(&self, groups: &[Value]) -> Value {
        let cutoff = now().saturating_sub(20);
        let rooms: std::collections::HashSet<_> = groups
            .iter()
            .filter_map(|g| g["channels"].as_array())
            .flatten()
            .filter(|c| c["kind"] == "voice")
            .map(|c| s(c, "id"))
            .collect();
        let mut presence =
            std::collections::BTreeMap::<_, std::collections::BTreeMap<_, (bool, bool)>>::new();
        for peer in &self.voice {
            let room = s(peer, "room");
            if !rooms.contains(room) || peer["seen"].as_u64().unwrap_or_default() <= cutoff {
                continue;
            }
            let muted = peer["muted"].as_bool().unwrap_or_default();
            let deaf = peer["deaf"].as_bool().unwrap_or_default();
            let status = presence
                .entry(room)
                .or_default()
                .entry(s(peer, "user"))
                .or_insert((true, true));
            status.0 &= muted || deaf;
            status.1 &= deaf;
        }
        json!(presence
            .into_iter()
            .map(|(room, people)| {
                let peers = people
                    .into_iter()
                    .map(|(user, (muted, deaf))| json!({"user":user,"muted":muted,"deaf":deaf}))
                    .collect::<Vec<_>>();
                (room, peers)
            })
            .collect::<std::collections::BTreeMap<_, _>>())
    }
    fn state(&self, u: &Value, separate_assets: bool) -> Value {
        let uid = s(u, "id");
        let mention_counts = self.unread_mention_counts(uid);
        let groups: Vec<_> = arr(&self.db["groups"])
            .into_iter()
            .filter(|g| arr(&g["members"]).contains(&json!(uid)))
            .map(|g| {
                let mut dto = self.group_dto(&g, uid);
                if let Some(channels) = dto["channels"].as_array_mut() {
                    for channel in channels {
                        let cid = s(channel, "id").to_owned();
                        channel["unreadCount"] = json!(self.unread_count(uid, &cid));
                        channel["unreadMentionCount"] = json!(mention_counts.get(&cid).copied().unwrap_or(0));
                    }
                }
                dto
            })
            .collect();
        let voice_presence = self.voice_presence(&groups);
        let messages: Vec<_> = self.db["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|message| self.message_visible(message, uid))
            .map(|message| self.receipt_message(message, uid))
            .collect();
        let sent: std::collections::HashSet<&str> = messages
            .iter()
            .map(|message| s(message, "sticker"))
            .filter(|id| !id.is_empty())
            .collect();
        let stickers: Vec<_> = self.db["stickers"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|original| {
                let in_history = sent.contains(s(original, "id"));
                if !in_history && !self.sticker_in_library(original, uid) {
                    return None;
                }
                let mut sticker = original.clone();
                if !separate_assets && sticker["asset"].is_string() {
                    if !in_history {
                        return None;
                    }
                    sticker["image"] = json!(self.sticker_image(original).ok()?);
                }
                sticker.as_object_mut().unwrap().remove("asset");
                self.decorate_sticker_catalog_dto(original, uid, &mut sticker);
                Some(sticker)
            })
            .collect();
        json!({"decorationSupported":true,"profileEffectDraftsSupported":self.profile_effect_drafts_supported(u),"effectCatalogSupported":true,"profileEffectUploadsSupported":true,"stickerCatalogSupported":true,"conversationMemberSearchSupported":true,"dialogMetadataSupported":true,"humanTypingSupported":true,"humanTyping":self.visible_human_typing(uid),"readReceiptsSupported":true,"me":self.public_for(u,uid),"email":u["email"],"chatPreferences":self.chat_preferences(u),"botTyping":self.visible_bot_typing(uid),"groups":groups,"voicePresence":voice_presence,"dialogCalls":self.dialog_calls.iter().filter(|c|self.dialog_member(uid,s(c,"dialog"))).map(|c|self.call_dto(c)).collect::<Vec<_>>(),"dialogs":arr(&self.db["dialogs"]).into_iter().filter(|d|arr(&d["members"]).contains(&json!(uid))).map(|d|{let mut dto=self.receipt_dialog(d,uid);dto["unreadMentionCount"]=json!(mention_counts.get(s(&dto,"id")).copied().unwrap_or(0));dto}).collect::<Vec<_>>(),"messages":messages,"stickers":stickers,"friends":arr(&self.db["friends"]).into_iter().filter(|x|x["from"]==uid||x["to"]==uid).collect::<Vec<_>>(),"bots":self.visible_bots(uid),"users":arr(&self.db["users"]).iter().map(|user|self.public_for(user,uid)).collect::<Vec<_>>()})
    }
    fn sticker_in_library(&self, sticker: &Value, uid: &str) -> bool {
        if self.sticker_pack_installed(sticker, uid) {
            return true;
        }
        if sticker["archived"] == true {
            return false;
        }
        let group = s(sticker, "group");
        if group.is_empty() {
            return sticker["owner"] == uid;
        }
        self.db["groups"]
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g["id"] == group && arr(&g["members"]).contains(&json!(uid)))
    }
    fn sticker_in_history(&self, sticker: &Value, uid: &str) -> bool {
        self.db["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["sticker"] == sticker["id"] && self.message_visible(m, uid))
    }
    fn sticker_asset_path(&self, asset: &str) -> PathBuf {
        self.path.with_file_name("sticker-assets").join(asset)
    }
    fn sticker_image(&self, sticker: &Value) -> Result<String, String> {
        if let Some(image) = sticker["image"].as_str() {
            return Ok(image.to_owned());
        }
        std::fs::read_to_string(self.sticker_asset_path(s(sticker, "asset")))
            .map_err(|_| "Изображение стикера недоступно".into())
    }
    fn editable_sticker_scope(&self, v: &Value, uid: &str) -> Result<String, String> {
        let group = s(v, "group");
        if !group.is_empty()
            && self
                .require_group_permission(group, uid, "stickers.manage")
                .is_err()
        {
            return Err("Наборы группы редактирует её владелец".into());
        }
        Ok(group.to_owned())
    }
    fn import_sticker_pack(&mut self, v: &Value, uid: &str) -> Result<Value, String> {
        let group = self.editable_sticker_scope(v, uid)?;
        let pack = s(v, "pack").trim();
        if pack.is_empty() || pack.chars().count() > 60 {
            return Err("Название набора: 1–60 символов".into());
        }
        let entries = v["stickers"]
            .as_array()
            .filter(|entries| (1..=48).contains(&entries.len()))
            .ok_or("Некорректная порция стикеров")?;
        let assets: Vec<_> = entries
            .iter()
            .map(|entry| {
                let name = s(entry, "name").trim();
                if name.is_empty() || name.chars().count() > 40 {
                    return Err("Название стикера: 1–40 символов".into());
                }
                let image = s(entry, "image");
                validate_sticker(image)?;
                let keywords = entry
                    .get("keywords")
                    .map(|value| {
                        let values = value
                            .as_array()
                            .filter(|values| values.len() <= 24)
                            .ok_or("Укажите до 24 ключевых слов")?;
                        let mut keywords = Vec::new();
                        for value in values {
                            let keyword =
                                value.as_str().ok_or("Некорректное ключевое слово")?.trim();
                            if keyword.is_empty() || keyword.chars().count() > 48 {
                                return Err("Ключевое слово: 1–48 символов");
                            }
                            if !keywords.contains(&keyword) {
                                keywords.push(keyword)
                            }
                        }
                        Ok(keywords)
                    })
                    .transpose()?;
                Ok::<_, String>((name, image, token_hash(image), keywords))
            })
            .collect::<Result<_, _>>()?;
        let mut metadata = Vec::new();
        for (name, image, digest, keywords) in assets {
            let stickers = self.db["stickers"].as_array_mut().unwrap();
            let in_scope = |sticker: &Value| {
                s(sticker, "group") == group && (!group.is_empty() || sticker["owner"] == uid)
            };
            if let Some(sticker) = stickers.iter_mut().find(|sticker| {
                in_scope(sticker)
                    && sticker["pack"] == pack
                    && sticker["name"] == name
                    && sticker["asset"] == digest
            }) {
                sticker["archived"] = json!(false);
                if let Some(keywords) = keywords {
                    sticker["keywords"] = json!(keywords);
                }
                continue;
            }
            let scope_count = stickers.iter().filter(|s| in_scope(s)).count();
            let pack_count = stickers
                .iter()
                .filter(|s| in_scope(s) && s["pack"] == pack)
                .count();
            if scope_count >= 1000 || pack_count >= 200 {
                return Err("В наборе может быть до 200 стикеров, в библиотеке — до 1000".into());
            }
            let mut sticker =
                json!({"id":id(),"owner":uid,"group":group,"pack":pack,"name":name,"asset":digest});
            if let Some(keywords) = keywords {
                sticker["keywords"] = json!(keywords);
            }
            stickers.push(sticker);
            metadata.push((image, digest));
        }
        let directory = self.path.with_file_name("sticker-assets");
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        for (image, digest) in metadata {
            let path = directory.join(digest);
            if path.exists() {
                continue;
            }
            let temporary = path.with_extension("tmp");
            std::fs::write(&temporary, image).map_err(|e| e.to_string())?;
            std::fs::rename(temporary, path).map_err(|e| e.to_string())?;
        }
        self.save()?;
        Ok(json!({"ok":true}))
    }
    pub fn request(&mut self, v: Value) -> Result<Value, String> {
        // Typing is strictly ephemeral: bypass even read-migration/session writes.
        if v["op"] == "set_typing" {
            return self.set_human_typing(&v);
        }
        if v["op"] == "search_conversation_members" {
            return self.search_conversation_members(&v);
        }
        self.prepare_read_state()?;
        if v["op"] == "profile_cover" {
            return self.profile_cover(&v);
        }
        if v["op"] == "set_profile_cover" {
            return self.set_profile_cover(&v);
        }
        if v["op"] == "set_profile_decoration" {
            return self.set_profile_decoration(&v);
        }
        if matches!(s(&v, "op"), "list_profile_effects" | "create_profile_effect" | "publish_profile_effect" | "unpublish_profile_effect" | "apply_profile_effect" | "upload_profile_effect" | "profile_effect_file") {
            return self.effect_catalog_request(&v);
        }
        if v["op"] == "attachment_file" {
            return self.attachment_file(&v);
        }
        if v["op"] == "sticker_image" {
            let user = self.authenticate(s(&v, "token"))?;
            let uid = s(&user, "id");
            let sticker = self.db["stickers"]
                .as_array()
                .unwrap()
                .iter()
                .find(|sticker| {
                    sticker["id"] == v["sticker"]
                        && (self.sticker_in_library(sticker, uid)
                            || self.sticker_in_history(sticker, uid)
                            || self.sticker_pack_is_public(sticker))
                })
                .ok_or("Стикер не найден")?;
            return Ok(json!({"image":self.sticker_image(sticker)?}));
        }
        let prev = self.db.clone();
        let result = self.action(v);
        if result.is_err() {
            self.db = prev
        }
        result.map(|mut data| {
            message_reads::strip_internal(&mut data);
            data
        })
    }
    fn action(&mut self, v: Value) -> Result<Value, String> {
        let op = s(&v, "op");
        if op == "login" || op == "register" {
            if self.retry_at > now() {
                return Err("Слишком много попыток. Подождите минуту".into());
            }
            let dto: CredentialsDto =
                serde_json::from_value(v.clone()).map_err(|_| "Проверьте данные входа")?;
            let email = dto.email.trim().to_lowercase();
            let password = dto.password.as_str();
            if email.len() > 254
                || !email.contains('@')
                || password.len() < 8
                || password.len() > 256
            {
                return Err("Проверьте почту и пароль (8–256 символов)".into());
            }
            let u = if op == "register" {
                let name = dto.name.trim();
                if name.chars().count() < 2 || name.chars().count() > 32 {
                    return Err("Имя: от 2 до 32 символов".into());
                }
                if arr(&self.db["users"]).iter().any(|u| u["email"] == email) {
                    return Err("Эта почта уже зарегистрирована".into());
                }
                let u = self.new_user(name, &email, password);
                self.db["users"].as_array_mut().unwrap().push(u.clone());
                u
            } else {
                let candidate = arr(&self.db["users"])
                    .into_iter()
                    .find(|u| u["email"] == email && u["bot"] != true);
                let salt = candidate
                    .as_ref()
                    .map(|u| s(u, "salt"))
                    .unwrap_or("unknown-account");
                let expected = candidate
                    .as_ref()
                    .and_then(|u| B64.decode(s(u, "hash")).ok())
                    .unwrap_or(vec![0; 32]);
                if pbkdf2::verify(
                    pbkdf2::PBKDF2_HMAC_SHA256,
                    NonZeroU32::new(600_000).unwrap(),
                    salt.as_bytes(),
                    password.as_bytes(),
                    &expected,
                )
                .is_err()
                {
                    self.failures += 1;
                    if self.failures >= 8 {
                        self.retry_at = now() + 60;
                        self.failures = 0
                    }
                    return Err("Неверная почта или пароль".into());
                }
                self.failures = 0;
                candidate.ok_or("Неверная почта или пароль")?
            };
            let token = self.token(&u, &dto.device, dto.remember_me)?;
            self.touch_presence(s(&u, "id"));
            return Ok(json!({"token":token,"user":self.public_for(&u,s(&u,"id"))}));
        }
        if [
            "bot_poll",
            "bot_message",
            "bot_get_me",
            "bot_register_commands",
            "bot_get_updates",
            "bot_ack",
            "bot_reply",
            "bot_authorize_update",
            "bot_attachment_file",
            "bot_edit",
            "bot_delete",
            "bot_typing",
            bot_decorations::OP,
            profile_effect_drafts::CLAIM,
            profile_effect_drafts::FINISH,
            bot_model_settings::OWNER_OP,
            "bot_get_settings",
            "bot_update_self",
            "bot_react",
        ]
        .contains(&op)
        {
            return self.bot_worker(&v);
        }
        if matches!(op, profile_effect_drafts::CREATE | profile_effect_drafts::GET) {
            return self.profile_effect_draft_user(&v);
        }
        let u = self.authenticate(s(&v, "token"))?;
        let uid = s(&u, "id");
        if [
            "create_bot",
            "delete_bot",
            "add_bot_to_group",
            "remove_bot_from_group",
            "bot_rotate_token",
            "bot_set_commands",
        ]
        .contains(&op)
        {
            return self.bot_management(&v, uid);
        }
        self.touch_presence(uid);
        if ["get_bot_tool_users", "set_bot_tool_users"].contains(&op) {
            return self.bot_tool_users(&v, uid);
        }
        if ["get_bot_settings", "update_bot_settings"].contains(&op) {
            return self.bot_settings_action(&v, uid);
        }
        if ["bot_get_model_settings", "bot_update_settings"].contains(&op) {
            return self.bot_model_settings_action(&v, uid);
        }
        if op == "diagnostics_recent" {
            // The seeded owner is first. Registration only appends, and user IDs do not change.
            if self.db["users"][0]["id"] != uid {
                return Err("DIAGNOSTICS_FORBIDDEN".into());
            }
            return self.diagnostics.recent();
        }
        if op == "diagnostics_report" {
            return self.diagnostics.report(&v["events"]);
        }
        let current = token_hash(s(&v, "token"));
        let session = self.db["sessions"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|x| x["token_hash"] == current)
            .unwrap();
        if session["last_seen"].as_u64().unwrap_or(0) + 60 < now() {
            session["last_seen"] = json!(now());
            self.save()?;
        }
        self.cleanup_calls(now());
        if op.starts_with("dialog_call_") {
            return self.dialog_call_action(&v, uid);
        }
        if matches!(op, "music_state" | "music_command" | "music_file") {
            return self.music_action(&v, uid, &current);
        }
        if op.starts_with("voice_") {
            return self.voice_action(&v, uid, &current);
        }
        if ["mark_messages_read", "message_readers"].contains(&op) {
            return self.message_reads_action(&v, uid);
        }
        if op == "update_dialog" {
            return self.update_dialog_metadata(&v, uid);
        }
        if ["set_notification_preferences", "set_dialog_preferences"].contains(&op) {
            return self.set_chat_preferences(&v, &u);
        }
        if [
            "save_group_role",
            "delete_group_role",
            "set_group_member_role",
            "kick_group_member",
            "leave_group",
            "rotate_group_invite",
            "set_group_member_invites",
        ]
        .contains(&op)
        {
            return self.group_management(&v, uid);
        }
        match op{
   "me"=>return Ok(json!({"user":self.public_for(&u,uid),"email":u["email"]})),
   "sessions"=>return Ok(json!(arr(&self.db["sessions"]).iter().filter(|x|x["user_id"]==uid&&session_active(x,now())).map(|x|json!({"id":x["id"],"device":x["device"],"created_at":x["created_at"],"last_seen":x["last_seen"],"expires_at":x["expires_at"],"current":x["token_hash"]==current})).collect::<Vec<_>>())),
   "revoke_session"=>{let sessions=self.db["sessions"].as_array_mut().unwrap();if !sessions.iter().any(|x|x["user_id"]==uid&&x["id"]==v["session_id"]){return Err("Сессия не найдена".into())}sessions.retain(|x|!(x["user_id"]==uid&&x["id"]==v["session_id"]));},
   "logout_all"=>self.db["sessions"].as_array_mut().unwrap().retain(|x|x["user_id"]!=uid),
   "update_profile"=>{let dto:ProfileDto=serde_json::from_value(v["profile"].clone()).map_err(|_|"Некорректный профиль")?;if let Some(ref avatar)=dto.avatar{validate_avatar(avatar)?;}let name=dto.name.trim();if !(2..=32).contains(&name.chars().count())||dto.bio.chars().count()>190{return Err("Имя: 2–32 символа, о себе: до 190".into())}let user=self.db["users"].as_array_mut().unwrap().iter_mut().find(|x|x["id"]==uid).unwrap();user["name"]=json!(name);user["bio"]=json!(dto.bio);if let Some(avatar)=dto.avatar{user["avatar"]=json!(avatar)}},
   "change_email"=>{
    let email=s(&v,"email").trim().to_lowercase();
    let parts:Vec<_>=email.split('@').collect();
    if email.len()>254||parts.len()!=2||parts[0].is_empty()||!parts[1].contains('.')||parts[1].starts_with('.')||parts[1].ends_with('.')||email.chars().any(char::is_whitespace){return Err("Введите корректную электронную почту".into())}
    let expected=B64.decode(s(&u,"hash")).map_err(|_|"Invalid password hash")?;
    pbkdf2::verify(pbkdf2::PBKDF2_HMAC_SHA256,NonZeroU32::new(600_000).unwrap(),s(&u,"salt").as_bytes(),s(&v,"current_password").as_bytes(),&expected).map_err(|_|"Неверный текущий пароль")?;
    if arr(&self.db["users"]).iter().any(|x|x["id"]!=uid&&x["email"]==email){return Err("Эта почта уже зарегистрирована".into())}
    self.db["users"].as_array_mut().unwrap().iter_mut().find(|x|x["id"]==uid).unwrap()["email"]=json!(email);
   },
   "change_password"=>{let password=s(&v,"password");if !(8..=256).contains(&password.len()){return Err("Пароль: 8–256 символов".into())}let expected=B64.decode(s(&u,"hash")).map_err(|_|"Invalid password hash")?;pbkdf2::verify(pbkdf2::PBKDF2_HMAC_SHA256,NonZeroU32::new(600_000).unwrap(),s(&u,"salt").as_bytes(),s(&v,"current_password").as_bytes(),&expected).map_err(|_|"Неверный текущий пароль")?;let salt=id();let user=self.db["users"].as_array_mut().unwrap().iter_mut().find(|x|x["id"]==uid).unwrap();user["salt"]=json!(salt);user["hash"]=json!(hash(password,&salt));self.db["sessions"].as_array_mut().unwrap().retain(|x|x["user_id"]!=uid);},
   "state"=>return Ok(self.state(&u,v["sticker_assets"]==true)),
   "logout"=>self.db["sessions"].as_array_mut().unwrap().retain(|x|x["token_hash"]!=current),
   "create_group"=>{let name=s(&v,"name").trim();if name.is_empty()||name.chars().count()>60{return Err("Название: 1–60 символов".into())}let group=json!({"id":id(),"name":name,"owner":uid,"invite":id(),"roles_revision":0,"member_invites":false,"members":[uid],"channels":[{"id":id(),"name":"общий","kind":"text"},{"id":id(),"name":"Гостиная","kind":"voice"}]});self.db["groups"].as_array_mut().unwrap().push(group.clone());self.save()?;return Ok(self.group_dto(&group,uid))},
   "join_group"=>{let g=self.db["groups"].as_array_mut().unwrap().iter_mut().find(|g|g["invite"]==s(&v,"invite")).ok_or("Приглашение не найдено")?;if !arr(&g["members"]).contains(&json!(uid)){g["members"].as_array_mut().unwrap().push(json!(uid));}let joined=g.clone();self.save()?;return Ok(self.group_dto(&joined,uid))},
   "invite_group_member"=>{
    let group_index=self.require_group_permission(s(&v,"group"),uid,"members.invite")?;
     let email=s(&v,"email").trim().to_lowercase();
    let (local,domain)=email.split_once('@').ok_or("Введите корректную электронную почту")?;
    if email.len()>254||local.is_empty()||domain.is_empty()||domain.contains('@')||email.chars().any(char::is_whitespace){
     return Err("Введите корректную электронную почту".into())
    }
    let invited_user=self.db["users"].as_array().unwrap().iter()
     .find(|user|user["email"]==email)
     .ok_or("Аккаунт с этой почтой не найден")?["id"].clone();
    let members=self.db["groups"][group_index]["members"].as_array_mut().unwrap();
    if members.contains(&invited_user){return Ok(json!({"ok":true}))}
    members.push(invited_user);
   },
   "update_group"=>{
    let index=self.db["groups"].as_array().unwrap().iter().position(|g|g["id"]==v["group"]).ok_or("GROUP_NOT_FOUND")?;
     if let Some(name)=v.get("name"){self.require_group_permission(s(&v,"group"),uid,"group.rename")?;let name=name.as_str().unwrap_or("").trim();if name.is_empty()||name.chars().count()>60{return Err("INVALID_NAME".into())}}
     if let Some(avatar)=v.get("avatar"){self.require_group_permission(s(&v,"group"),uid,"group.avatar")?;validate_avatar(avatar.as_str().ok_or("INVALID_AVATAR")?)?;}
     if v.get("name").is_none()&&v.get("avatar").is_none(){return Err("EMPTY_PATCH".into())}
     if let Some(name)=v.get("name"){self.db["groups"][index]["name"]=json!(name.as_str().unwrap().trim());}
     if let Some(avatar)=v.get("avatar"){self.db["groups"][index]["avatar"]=avatar.clone();}
     self.save()?;return Ok(self.group_dto(&self.db["groups"][index],uid))
    },
   "update_channel"=>{let name=s(&v,"name").trim();if name.is_empty()||name.chars().count()>40{return Err("Название канала: 1–40 символов".into())}let index=self.require_group_permission(s(&v,"group"),uid,"channels.rename")?;let g=&mut self.db["groups"][index];let channel=g["channels"].as_array_mut().unwrap().iter_mut().find(|c|c["id"]==v["channel"]).ok_or("Канал не найден")?;channel["name"]=json!(name);let updated=channel.clone();self.save()?;return Ok(updated)},
   "delete_channel"=>{
    let index=self.require_group_permission(s(&v,"group"),uid,"channels.delete")?;let channels=self.db["groups"][index]["channels"].as_array_mut().unwrap();
     let channel=&v["channel"];
    let index=channels.iter().position(|row|&row["id"]==channel).ok_or("Канал не найден")?;
    channels.remove(index);
    self.db["messages"].as_array_mut().unwrap().retain(|row|&row["channel"]!=channel);
    self.db["bots"].as_array_mut().unwrap().retain(|row|&row["channel"]!=channel);
    self.save()?;
    let clients:Vec<Value>=self.voice.iter().filter(|row|&row["room"]==channel).map(|row|row["client"].clone()).collect();
    self.voice.retain(|row|&row["room"]!=channel);
    self.signals.retain(|signal|!clients.contains(&signal["from"])&&!clients.contains(&signal["target"]));
    return Ok(json!({"ok":true}))
   },
   "create_channel"=>{let name=s(&v,"name").trim();if name.is_empty()||name.chars().count()>40{return Err("Название канала: 1–40 символов".into())}let permission=match s(&v,"kind"){"text"=>"channels.create_text","voice"=>"channels.create_voice",_=>return Err("INVALID_KIND".into())};let index=self.require_group_permission(s(&v,"group"),uid,permission)?;let g=&mut self.db["groups"][index];let channel=json!({"id":id(),"name":name,"kind":if v["kind"]=="voice"{"voice"}else{"text"}});g["channels"].as_array_mut().unwrap().push(channel.clone());self.save()?;return Ok(channel)},
   "create_dialog"=>{let mut members=vec![json!(uid)];for member in arr(&v["members"]){if !arr(&self.db["users"]).iter().any(|u|u["id"]==member){return Err("Пользователь не найден".into())}if let Some(bot)=arr(&self.db["bots"]).iter().find(|b|b["id"]==member){if bot["legacy"]==true||bot["enabled"]==false||arr(&v["members"]).len()!=1{return Err("Bot requires a direct dialog".into())}}if !members.contains(&member){members.push(member)}}if members.len()<2||members.len()>10{return Err("Выберите от 1 до 9 собеседников".into())}if members.len()==2{if let Some(d)=arr(&self.db["dialogs"]).iter().find(|d|arr(&d["members"]).len()==2&&members.iter().all(|m|arr(&d["members"]).contains(m))){return Ok(d.clone())}}let name=s(&v,"name").trim();if name.chars().count()>60{return Err("Название слишком длинное".into())}let d=json!({"id":id(),"name":if name.is_empty(){"Личный диалог"}else{name},"members":members,"owner":uid});self.db["dialogs"].as_array_mut().unwrap().push(d.clone());self.save()?;return Ok(d)},
   "friend_request"=>{
    let target=s(&v,"user");if target==uid||!arr(&self.db["users"]).iter().any(|x|x["id"]==target&&x["bot"]!=true){return Err("Выберите пользователя".into())}
    if arr(&self.db["friends"]).iter().any(|x|(x["from"]==uid&&x["to"]==target)||(x["from"]==target&&x["to"]==uid)){return Err("Заявка или дружба уже существует".into())}
    self.db["friends"].as_array_mut().unwrap().push(json!({"id":id(),"from":uid,"to":target,"accepted":false}));
   },
   "friend_accept"|"friend_remove"=>{
    let rows=self.db["friends"].as_array_mut().unwrap();let i=rows.iter().position(|x|x["id"]==v["id"]&&(x["from"]==uid||x["to"]==uid)).ok_or("Заявка не найдена")?;
    if op=="friend_accept" {if rows[i]["to"]!=uid{return Err("Заявку принимает получатель".into())}rows[i]["accepted"]=json!(true);}else{rows.remove(i);}
   },
   "import_sticker_pack"=>return self.import_sticker_pack(&v,uid),
   "list_public_sticker_packs" | "set_sticker_pack_public" | "install_public_sticker_pack" | "remove_installed_sticker_pack" => return self.sticker_catalog_request(&v, uid),
   "remove_sticker"|"remove_sticker_pack"=>{
    let group=self.editable_sticker_scope(&v,uid)?;
    let mut changed=false;
    for sticker in self.db["stickers"].as_array_mut().unwrap(){
     if s(sticker,"group")!=group||(group.is_empty()&&sticker["owner"]!=uid){continue}
     let matches=if op=="remove_sticker"{sticker["id"]==v["sticker"]}
      else{!s(&v,"pack").is_empty()&&sticker["pack"]==v["pack"]};
     if matches{sticker["archived"]=json!(true);changed=true;}
    }
    if !changed{return Err("Стикер или набор не найден".into())}
     if group.is_empty(){self.prune_empty_public_sticker_packs(uid);}
   },
   "create_sticker"=>{
    let data=s(&v,"image");let name=s(&v,"name").trim();if name.is_empty()||name.chars().count()>40{return Err("Название стикера: 1–40 символов".into())}
    validate_sticker(data)?;
    if arr(&self.db["stickers"]).iter().filter(|x|x["owner"]==uid&&x["asset"].is_null()&&x["archived"]!=true).count()>=100{return Err("В наборе уже 100 стикеров".into())}
    let group=self.editable_sticker_scope(&v,uid)?;
     let sticker=json!({"id":id(),"owner":uid,"group":group,"name":name,"image":data});self.db["stickers"].as_array_mut().unwrap().push(sticker.clone());self.save()?;return Ok(sticker);
   },
   "reaction"=>{
    let message=arr(&self.db["messages"]).into_iter().find(|m|m["id"]==v["message"]).ok_or("Сообщение не найдено")?;
    if !self.allowed(uid,s(&message,"channel")){return Err("Нет доступа к чату".into())}
    let emoji=s(&v,"emoji");if !["👍","❤️","😂","🔥","🎉","👀"].contains(&emoji){return Err("Выберите реакцию".into())}
    let row=self.db["messages"].as_array_mut().unwrap().iter_mut().find(|m|m["id"]==v["message"]).unwrap();
    let mut reactions=arr(&row["reactions"]);if let Some(i)=reactions.iter().position(|r|r["user"]==uid&&r["emoji"]==emoji){reactions.remove(i);}else{reactions.push(json!({"user":uid,"emoji":emoji}));}row["reactions"]=json!(reactions);
   },
   "delete_message"|"update_message"=>{
    let (index,message)=self.db["messages"].as_array().unwrap().iter().enumerate()
     .find(|(_,message)|message["id"]==v["message"]&&self.allowed(uid,s(message,"channel")))
     .ok_or("Сообщение не найдено")?;
    let author=message["user"]==uid&&s(message,"bot_name").is_empty();
    if op=="update_message"{
     if !author{return Err("Сообщение может редактировать только его автор".into())}
     if s(message,"text").is_empty(){return Err("В сообщении нет текста для редактирования".into())}
     let text=s(&v,"text").trim();
     if text.is_empty()||text.chars().count()>2000{return Err("Сообщение: 1–2000 символов".into())}
     let mentions=self.canonical_mentions(s(message,"channel"),text,v.get("mentions"))?;
      self.db["messages"][index]["text"]=json!(text);
      self.db["messages"][index]["mentions"]=mentions;
     for update in self.db["bot_updates"].as_array_mut().unwrap(){if update["message"]["id"]==v["message"]{update["source_cancelled"]=json!(true);}}
    }else{
     let for_everyone=v.get("for_everyone")
      .map_or(Ok(false),|value|value.as_bool().ok_or("Выберите, для кого удалить сообщение"))?;
     if for_everyone{
      if !author&&!arr(&self.db["groups"]).iter().any(|g|arr(&g["channels"]).iter().any(|c|c["id"]==message["channel"])&&self.group_permission(g,uid,"messages.delete_any")){return Err("MODERATION_FORBIDDEN".into())}
      self.db["messages"].as_array_mut().unwrap().remove(index);
     }else{
      let message=&mut self.db["messages"][index];
      if message["hidden_by"].is_null(){message["hidden_by"]=json!([]);}
      let users=message["hidden_by"].as_array_mut().ok_or("STORAGE_UNAVAILABLE")?;
      if !users.iter().any(|user|user==uid){users.push(json!(uid));}
     }
    }
   },
   "message"=>{let channel=s(&v,"channel");if !self.allowed(uid,channel){return Err("Нет доступа к чату".into())}let text=s(&v,"text").trim();let sticker=s(&v,"sticker");
    if !sticker.is_empty(){
     let sticker=self.db["stickers"].as_array().unwrap().iter().find(|row|row["id"]==sticker&&(row["archived"]!=true||self.sticker_pack_installed(row,uid))).ok_or("Стикер не найден")?;
     let group=s(sticker,"group");
     let sendable=if group.is_empty(){
      self.sticker_in_library(sticker,uid)||self.sticker_in_history(sticker,uid)
     }else{
      self.db["groups"].as_array().unwrap().iter().any(|row|row["id"]==group&&arr(&row["channels"]).iter().any(|c|c["id"]==channel))
     };
     if !sendable{return Err("Стикер не найден".into())}
    }
    let attachment=v.get("attachment").filter(|value|!value.is_null());
     if (text.is_empty()&&sticker.is_empty()&&attachment.is_none())||text.chars().count()>2000{return Err("Сообщение: 1–2000 символов или вложение".into())}
     let mentions=self.canonical_mentions(channel,text,v.get("mentions"))?;
      let attachment=attachment.map(|value|self.store_attachment(value)).transpose()?;
     let mut message=json!({"id":id(),"channel":channel,"user":uid,"text":text,"sticker":sticker,"time":now(),"mentions":mentions});
     if let Some(ref attachment)=attachment{message["attachment"]=attachment.clone();}
     if let Err(error)=self.enqueue_bots(&message){if let Some(path)=attachment.as_ref().and_then(|value|self.attachment_path(value)){let _=std::fs::remove_file(path);}return Err(error)}self.db["messages"].as_array_mut().unwrap().push(message);
     if let Err(error)=self.save(){
      if let Some(path)=attachment.as_ref().and_then(|value|self.attachment_path(value)){let _=std::fs::remove_file(path);}
      return Err(error)
     }
     self.clear_human_typing(uid,channel);return Ok(json!({"ok":true}));},
   _=>return Err("Неизвестная команда".into())
  }
        self.save()?;
        if matches!(op, "logout" | "logout_all" | "change_password") {
            self.human_typing.remove(uid);
        }
        Ok(json!({"ok":true}))
    }
}
#[cfg(test)]
mod tests {
    #[test]
    fn authenticated_turn_uses_expiring_credentials_and_keeps_static_ice() {
        let configured = json!([{"urls":"stun:example.test:3478"}]);
        let relay =
            r#"["turn:example.test:3478?transport=udp","turn:example.test:3478?transport=tcp"]"#;
        let merged = voice_ice_servers(
            configured.clone(),
            Some(relay),
            Some("test-secret"),
            "fixture",
            1_700_000_000,
        );
        assert_eq!(merged[0], configured[0]);
        assert_eq!(merged[1]["username"], "1700043200:fixture");
        assert_eq!(merged[1]["credential"], "AzZu1XjeI2CBkBqGhUWUMdtthMI=");
        assert_eq!(
            merged[1]["urls"],
            serde_json::from_str::<Value>(relay).unwrap()
        );
        assert_eq!(
            voice_ice_servers(configured.clone(), Some(relay), None, "fixture", 0),
            configured
        );
        assert_eq!(
            voice_ice_servers(
                configured.clone(),
                Some(r#"["https://example.test"]"#),
                Some("test-secret"),
                "fixture",
                0
            ),
            configured
        );
    }

    #[test]
    fn state_reports_who_is_online() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let owner = b.db["users"][0].clone();
        let token = b.token(&owner, "test", false).unwrap();
        let guest=b.request(json!({"op":"register","name":"Guest","email":"presence@example.test","password":"strong-password"})).unwrap();
        let guest_id = guest["user"]["id"].clone();
        assert_eq!(guest["user"]["online"], json!(true));
        let state = b.request(json!({"op":"state","token":token})).unwrap();
        let list = arr(&state["users"]);
        let guest_state = list.iter().find(|user| user["id"] == guest_id).unwrap();
        assert_eq!(guest_state["online"], json!(true));
        assert!(guest_state["last_seen"].as_u64().unwrap() > 0);
        assert_eq!(state["me"]["online"], json!(true));
        let key = guest_id.as_str().unwrap().to_string();
        b.presence
            .insert(key.clone(), now().saturating_sub(PRESENCE_TTL + 5));
        let stale = b.request(json!({"op":"state","token":token})).unwrap();
        let stale_guest = arr(&stale["users"])
            .into_iter()
            .find(|user| user["id"] == guest_id)
            .unwrap();
        assert_eq!(stale_guest["online"], json!(false));
        b.presence.remove(&key);
        let gone = b.request(json!({"op":"state","token":token})).unwrap();
        let gone_guest = arr(&gone["users"])
            .into_iter()
            .find(|user| user["id"] == guest_id)
            .unwrap();
        assert_eq!(gone_guest["online"], json!(false));
        assert_eq!(gone_guest["last_seen"], json!(0));
        drop(b);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn message_actions_respect_channel_access_authorship_and_account_visibility() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut backend = Backend::open(path.clone()).unwrap();
        let owner = backend.db["users"][0].clone();
        let owner_token = json!(backend.token(&owner, "test", false).unwrap());
        let guest=backend.request(json!({"op":"register","name":"Guest","email":"message-actions@example.test","password":"strong-password"})).unwrap();
        let guest_id = &guest["user"]["id"];
        let guest_token = &guest["token"];
        let group = backend.db["groups"][0].clone();
        let channel = &group["channels"][0]["id"];
        backend
            .request(
                json!({"op":"message","token":owner_token,"channel":channel,"text":"Owner text"}),
            )
            .unwrap();
        let owner_message = backend.db["messages"][0]["id"].clone();
        let remove = |token: &Value, message: &Value, for_everyone: bool| json!({"op":"delete_message","token":token,"message":message,"for_everyone":for_everyone});
        let edit = |token: &Value, message: &Value, text: &str| json!({"op":"update_message","token":token,"message":message,"text":text});
        assert_eq!(
            backend
                .request(remove(guest_token, &owner_message, false))
                .unwrap_err(),
            "Сообщение не найдено"
        );
        assert_eq!(
            backend
                .request(edit(guest_token, &owner_message, "Outsider"))
                .unwrap_err(),
            "Сообщение не найдено"
        );
        backend
            .request(json!({"op":"join_group","token":guest_token,"invite":group["invite"]}))
            .unwrap();
        backend
            .request(
                json!({"op":"message","token":guest_token,"channel":channel,"text":"Guest text"}),
            )
            .unwrap();
        let guest_message = backend.db["messages"][1]["id"].clone();
        assert!(backend.group_permission(&group, s(&owner, "id"), "messages.delete_any"));
        assert!(backend
            .request(edit(&owner_token, &guest_message, "Channel owner"))
            .is_err());
        assert!(backend
            .request(edit(guest_token, &guest_message, "  "))
            .is_err());
        assert!(backend
            .request(edit(guest_token, &guest_message, &"a".repeat(2001)))
            .is_err());
        let mut expected = backend.public_message(&backend.db["messages"][1]);
        assert_eq!(&expected["user"], guest_id);
        expected["text"] = json!("Обновлено");
        backend
            .request(edit(guest_token, &guest_message, "  Обновлено  "))
            .unwrap();
        backend
            .request(json!({"op":"delete_message","token":owner_token,"message":guest_message}))
            .unwrap();
        backend
            .request(remove(&owner_token, &guest_message, false))
            .unwrap();
        assert_eq!(backend.db["messages"][1]["hidden_by"], json!([owner["id"]]));
        drop(backend);
        let mut backend = Backend::open(path.clone()).unwrap();
        assert_eq!(
            backend
                .request(json!({"op":"state","token":owner_token}))
                .unwrap()["messages"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let mut own_expected = expected.clone();
        own_expected["readCount"] = json!(0);
        assert_eq!(
            backend
                .request(json!({"op":"state","token":guest_token}))
                .unwrap()["messages"][1],
            own_expected
        );
        let bot = backend
            .request(
                json!({"op":"create_bot","token":owner_token,"channel":channel,"name":"Helper"}),
            )
            .unwrap();
        assert_eq!(
            backend
                .request(json!({"op":"bot_poll","bot_token":bot["token"]}))
                .unwrap()["messages"][1],
            expected
        );
        backend
            .request(remove(guest_token, &guest_message, true))
            .unwrap();
        drop(backend);
        let backend = Backend::open(path.clone()).unwrap();
        assert_eq!(backend.db["messages"].as_array().unwrap().len(), 1);
        assert_eq!(backend.db["messages"][0]["id"], owner_message);
        assert_eq!(backend.db["messages"][0]["user"], owner["id"]);
        drop(backend);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn sticker_packs_are_scoped_retryable_and_keep_sent_images() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let owner = b.db["users"][0].clone();
        let token = b.token(&owner, "test", false).unwrap();
        let guest=b.request(json!({"op":"register","name":"Guest","email":"pack@example.test","password":"strong-password"})).unwrap();
        let gt = &guest["token"];
        let group = b
            .request(json!({"op":"create_group","name":"Pack QA","token":token}))
            .unwrap();
        let other = b
            .request(json!({"op":"create_group","name":"Other","token":token}))
            .unwrap();
        let items = json!([{"name":"One","image":"data:image/png;base64,iVBORw0KGgo="}]);
        let import = json!({"op":"import_sticker_pack","token":token,"pack":"Test","group":group["id"],"stickers":items});
        let mut denied = import.clone();
        denied["token"] = gt.clone();
        assert!(b.request(denied).is_err());
        b.request(import.clone()).unwrap();
        let mut tagged = import.clone();
        tagged["stickers"][0]["keywords"] = json!([" привет ", "здравствуй", "привет"]);
        b.request(tagged).unwrap();
        b.request(import).unwrap();
        b.request(
            json!({"op":"import_sticker_pack","token":token,"pack":"Personal","stickers":items}),
        )
        .unwrap();
        let state = b
            .request(json!({"op":"state","token":token,"sticker_assets":true}))
            .unwrap();
        assert_eq!(arr(&state["stickers"]).len(), 2);
        assert_eq!(
            state["stickers"][0]["keywords"],
            json!(["привет", "здравствуй"])
        );
        assert!(state["stickers"][1]["keywords"].is_null());
        let sticker = &state["stickers"][0]["id"];
        let asset = json!({"op":"sticker_image","token":gt,"sticker":sticker});
        assert!(b.request(asset.clone()).is_err());
        b.request(json!({"op":"join_group","token":gt,"invite":group["invite"]}))
            .unwrap();
        assert_eq!(
            b.request(asset.clone()).unwrap()["image"],
            items[0]["image"]
        );
        let personal = &state["stickers"][1]["id"];
        assert!(b
            .request(json!({"op":"sticker_image","token":gt,"sticker":personal}))
            .is_err());
        assert!(b.request(json!({"op":"message","token":token,"channel":other["channels"][0]["id"],"sticker":sticker})).is_err());
        b.request(json!({"op":"message","token":gt,"channel":group["channels"][0]["id"],"sticker":sticker})).unwrap();
        b.request(
            json!({"op":"remove_sticker_pack","token":token,"group":group["id"],"pack":"Test"}),
        )
        .unwrap();
        drop(b);
        let mut b = Backend::open(path).unwrap();
        let archived = b
            .request(json!({"op":"state","token":gt,"sticker_assets":true}))
            .unwrap();
        assert_eq!(
            archived["stickers"][0]["keywords"],
            json!(["привет", "здравствуй"])
        );
        assert_eq!(b.request(asset).unwrap()["image"], items[0]["image"]);
        assert!(b.request(json!({"op":"message","token":gt,"channel":group["channels"][0]["id"],"sticker":sticker})).is_err());
    }

    // unreadCount/unreadMentionCount are per-viewer state projections, never stored
    // channel fields: create/keep replies stay identical and state adds exactly these
    // two keys on top of the stored channel.
    fn channel_without_unread(mut channel: Value) -> Value {
        for key in ["unreadCount", "unreadMentionCount"] {
            assert!(channel[key].is_u64(), "state channel must project {key}");
            channel.as_object_mut().unwrap().remove(key);
        }
        channel
    }

    #[test]
    fn channel_delete_removes_only_the_owned_channel_and_its_content() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut backend = Backend::open(path.clone()).unwrap();
        let owner = backend.db["users"][0].clone();
        let token = backend.token(&owner, "test", false).unwrap();
        let group = backend
            .request(json!({"op":"create_group","token":token,"name":"Project"}))
            .unwrap();
        let room = &group["channels"][1]["id"];
        let kept = &group["channels"][0]["id"];
        for channel in [room, kept] {
            backend
                .request(json!({"op":"message","token":token,"channel":channel,"text":"History"}))
                .unwrap();
        }
        let bot = backend
            .request(json!({"op":"create_bot","token":token,"channel":room,"name":"Helper"}))
            .unwrap();
        let client = id();
        backend
            .request(json!({"op":"voice_join","token":token,"room":room,"client":client}))
            .unwrap();
        let guest=backend.request(json!({"op":"register","name":"Guest","email":"delete@example.test","password":"strong-password"})).unwrap();
        backend
            .request(json!({"op":"join_group","token":guest["token"],"invite":group["invite"]}))
            .unwrap();
        let delete =
            json!({"op":"delete_channel","token":token,"group":group["id"],"channel":room});
        let mut denied = delete.clone();
        denied["token"] = guest["token"].clone();
        assert!(backend.request(denied).is_err());
        backend.request(delete.clone()).unwrap();
        assert!(backend.voice.is_empty());
        assert!(backend
            .request(json!({"op":"bot_poll","bot_token":bot["token"]}))
            .is_err());
        assert!(backend.request(delete).is_err());
        drop(backend);
        let mut backend = Backend::open(path).unwrap();
        let state = backend
            .request(json!({"op":"state","token":guest["token"]}))
            .unwrap();
        assert_eq!(
            json!(arr(&state["groups"][0]["channels"])
                .into_iter()
                .map(channel_without_unread)
                .collect::<Vec<_>>()),
            json!([group["channels"][0]])
        );
        assert_eq!(arr(&state["messages"]).len(), 1);
        assert_eq!(&state["messages"][0]["channel"], kept);
    }

    #[test]
    fn channel_edit_requires_owner_and_preserves_history() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let owner = b.db["users"][0].clone();
        let token = b.token(&owner, "test", false).unwrap();
        let g = b.db["groups"][0].clone();
        let guest=b.request(json!({"op":"register","name":"Guest","email":"edit@test.local","password":"strong-password"})).unwrap();
        b.request(json!({"op":"join_group","token":guest["token"],"invite":g["invite"]}))
            .unwrap();
        for c in arr(&g["channels"]) {
            b.request(json!({"op":"message","token":token,"channel":c["id"],"text":"Keep me"}))
                .unwrap();
            assert!(b.request(json!({"op":"update_channel","token":guest["token"],"group":g["id"],"channel":c["id"],"name":"Forbidden"})).is_err());
            for name in [String::new(), " ".into(), "a".repeat(41)] {
                assert!(b.request(json!({"op":"update_channel","token":token,"group":g["id"],"channel":c["id"],"name":name})).is_err());
            }
            let edited=b.request(json!({"op":"update_channel","token":token,"group":g["id"],"channel":c["id"],"name":" Updated "})).unwrap();
            assert_eq!(edited["id"], c["id"]);
            assert_eq!(edited["kind"], c["kind"]);
            assert_eq!(edited["name"], "Updated");
        }
        drop(b);
        let mut b = Backend::open(path).unwrap();
        let state = b.request(json!({"op":"state","token":token})).unwrap();
        assert!(arr(&state["groups"][0]["channels"])
            .iter()
            .all(|c| c["name"] == "Updated"));
        assert_eq!(arr(&state["messages"]).len(), arr(&g["channels"]).len());
    }

    use super::*;

    #[test]
    fn group_settings_require_owner_and_preserve_group() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut backend = Backend::open(path.clone()).unwrap();
        let owner = backend.db["users"][0].clone();
        let token = backend.token(&owner, "test", false).unwrap();
        let group = backend
            .request(json!({"op":"create_group","token":token,"name":"Original"}))
            .unwrap();
        let guest=backend.request(json!({"op":"register","name":"Guest","email":"rename@example.test","password":"strong-password"})).unwrap();
        backend
            .request(json!({"op":"join_group","token":guest["token"],"invite":group["invite"]}))
            .unwrap();
        let before = backend.group_dto(
            backend.db["groups"]
                .as_array()
                .unwrap()
                .iter()
                .find(|g| g["id"] == group["id"])
                .unwrap(),
            s(&owner, "id"),
        );
        let avatar = "data:image/png;base64,iVBORw0KGgo=";
        assert!(backend.request(json!({"op":"update_group","token":guest["token"],"group":group["id"],"name":"Forbidden"})).is_err());
        assert!(backend.request(json!({"op":"update_group","token":guest["token"],"group":group["id"],"avatar":avatar})).is_err());
        assert!(backend.request(json!({"op":"update_group","token":token,"group":group["id"],"avatar":"https://invalid"})).is_err());
        for name in ["   ".to_string(), "а".repeat(61)] {
            assert!(backend
                .request(json!({"op":"update_group","token":token,"group":group["id"],"name":name}))
                .is_err());
        }
        let mut expected = before;
        expected["avatar"] = json!(avatar);
        let with_avatar = backend
            .request(json!({"op":"update_group","token":token,"group":group["id"],"avatar":avatar}))
            .unwrap();
        assert_eq!(with_avatar, expected);
        let renamed=backend.request(json!({"op":"update_group","token":token,"group":group["id"],"name":" Новое название "})).unwrap();
        expected["name"] = json!("Новое название");
        assert_eq!(renamed, expected);
        drop(backend);
        let mut backend = Backend::open(path).unwrap();
        let mut member_expected = expected.clone();
        member_expected["permissions"] = json!([]);
        member_expected["invite"] = json!("");
        let mut member_state = backend
            .request(json!({"op":"state","token":guest["token"]}))
            .unwrap()["groups"][0]
            .clone();
        member_state["channels"] = json!(arr(&member_state["channels"])
            .into_iter()
            .map(channel_without_unread)
            .collect::<Vec<_>>());
        assert_eq!(member_state, member_expected);
        let cleared = backend
            .request(json!({"op":"update_group","token":token,"group":group["id"],"avatar":""}))
            .unwrap();
        expected["avatar"] = json!("");
        assert_eq!(cleared, expected);
    }

    #[test]
    fn group_email_invite_grants_persistent_text_and_voice_access() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut backend = Backend::open(path.clone()).unwrap();
        let owner = backend.db["users"][0].clone();
        let owner_token = backend.token(&owner, "test", false).unwrap();
        let guest=backend.request(json!({"op":"register","name":"Guest","email":"guest@example.test","password":"strong-password"})).unwrap();
        let guest_token = &guest["token"];
        let group = backend
            .request(json!({"op":"create_group","token":owner_token,"name":"Project"}))
            .unwrap();
        let invite = json!({"op":"invite_group_member","token":owner_token,"group":group["id"],"email":" Guest@Example.Test "});
        let message = json!({"op":"message","token":guest_token,"channel":group["channels"][0]["id"],"text":"Hello"});
        let voice = json!({"op":"voice_join","token":guest_token,"room":group["channels"][1]["id"],"client":id()});
        let state = json!({"op":"state","token":guest_token});
        assert_eq!(backend.request(state.clone()).unwrap()["groups"], json!([]));
        assert!(backend.request(message.clone()).is_err());
        assert!(backend.request(voice.clone()).is_err());
        let mut unauthorized = invite.clone();
        unauthorized["token"] = guest_token.clone();
        assert!(backend.request(unauthorized).is_err());
        let mut unknown = invite.clone();
        unknown["email"] = json!("unknown@example.test");
        assert_eq!(
            backend.request(unknown).unwrap_err(),
            "Аккаунт с этой почтой не найден"
        );
        backend.request(invite.clone()).unwrap();
        backend.request(invite).unwrap();

        drop(backend);
        let mut backend = Backend::open(path).unwrap();
        let joined = &backend.request(state).unwrap()["groups"][0];
        assert_eq!(joined["id"], group["id"]);
        assert_eq!(joined["members"], json!([owner["id"], guest["user"]["id"]]));
        backend.request(message).unwrap();
        assert_eq!(
            backend.request(voice).unwrap()["peers"][0]["user"],
            guest["user"]["id"]
        );
    }

    #[test]
    fn created_rooms_return_persisted_identity() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let a=b.request(json!({"op":"register","name":"Alice","email":"rooms@test.local","password":"strong-password"})).unwrap();
        let t = &a["token"];
        let g = b
            .request(json!({"op":"create_group","token":t,"name":"Project"}))
            .unwrap();
        assert!(
            g["id"].is_string(),
            "Creation must identify the saved group"
        );
        let c=b.request(json!({"op":"create_channel","token":t,"group":g["id"],"name":"Planning","kind":"text"})).unwrap();
        assert!(c["id"].is_string());
        let other=b.request(json!({"op":"register","name":"Bob","email":"rooms-b@test.local","password":"strong-password"})).unwrap();
        let bt = &other["token"];
        assert!(b
            .request(json!({"op":"message","token":bt,"channel":c["id"],"text":"private"}))
            .is_err());
        let joined = b
            .request(json!({"op":"join_group","token":bt,"invite":g["invite"]}))
            .unwrap();
        assert_eq!(joined["id"], g["id"]);
        b.request(json!({"op":"join_group","token":bt,"invite":g["invite"]}))
            .unwrap();
        b.request(json!({"op":"message","token":bt,"channel":c["id"],"text":"Saved message"}))
            .unwrap();
        drop(b);
        let mut b = Backend::open(path).unwrap();
        let state = b.request(json!({"op":"state","token":t})).unwrap();
        assert_eq!(state["groups"][0]["id"], g["id"]);
        assert_eq!(arr(&state["groups"][0]["members"]).len(), 2);
        assert!(arr(&state["groups"][0]["channels"])
            .into_iter()
            .map(channel_without_unread)
            .collect::<Vec<_>>()
            .contains(&c));
        assert_eq!(state["messages"][0]["text"], "Saved message");
    }

    #[test]
    fn account_avatar_and_email() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let a=b.request(json!({"op":"register","name":"Avatar","email":"avatar@test.local","password":"strong-password"})).unwrap();
        let t = &a["token"];
        let avatar = "data:image/png;base64,iVBORw0KGgo=";
        b.request(json!({"op":"update_profile","token":t,"profile":{"name":"Avatar","bio":"","avatar":avatar}})).unwrap();
        assert_eq!(
            b.request(json!({"op":"me","token":t})).unwrap()["user"]["avatar"],
            avatar
        );
        assert!(b.request(json!({"op":"update_profile","token":t,"profile":{"name":"Avatar","bio":"","avatar":"https://invalid"}})).is_err());
        assert!(b.request(json!({"op":"change_email","token":t,"email":"new@test.local","current_password":"wrong"})).is_err());
        assert!(b.request(json!({"op":"change_email","token":t,"email":"broken@","current_password":"strong-password"})).is_err());
        b.request(json!({"op":"register","name":"Other","email":"taken@test.local","password":"strong-password"})).unwrap();
        assert!(b.request(json!({"op":"change_email","token":t,"email":"taken@test.local","current_password":"strong-password"})).is_err());
        b.request(json!({"op":"change_email","token":t,"email":" NEW@test.local ","current_password":"strong-password"})).unwrap();
        assert!(b
            .request(json!({"op":"login","email":"avatar@test.local","password":"strong-password"}))
            .is_err());
        let mut b = Backend::open(path).unwrap();
        let login = b
            .request(json!({"op":"login","email":"new@test.local","password":"strong-password"}))
            .unwrap();
        assert_eq!(login["user"]["avatar"], avatar);
    }
    #[test]
    fn sessions_profile_and_migration() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let credentials = json!({"op":"register","name":"Alice","email":"session@test.local","password":"strong-password","device":"Device A"});
        let a = b.request(credentials.clone()).unwrap();
        let mut login = credentials;
        login["op"] = json!("login");
        login["device"] = json!("Device B");
        let c = b.request(login.clone()).unwrap();
        let at = s(&a, "token");
        let ct = s(&c, "token");
        let sessions = b.request(json!({"op":"sessions","token":at})).unwrap();
        assert_eq!(arr(&sessions).len(), 2);
        assert!(!sessions.to_string().contains("token_hash"));
        assert!(!std::fs::read_to_string(&path).unwrap().contains(at));
        b.request(json!({"op":"logout","token":at})).unwrap();
        assert!(b.authenticate(at).is_err());
        assert!(b.authenticate(ct).is_ok());
        b.request(
            json!({"op":"update_profile","token":ct,"profile":{"name":"New Alice","bio":"Hello"}}),
        )
        .unwrap();
        assert!(b.request(json!({"op":"update_profile","token":ct,"profile":{"name":"Alice","bio":"","email":"hijack@test"}})).is_err());
        drop(b);
        let mut b = Backend::open(path.clone()).unwrap();
        assert_eq!(
            b.request(json!({"op":"me","token":ct})).unwrap()["user"]["bio"],
            "Hello"
        );
        let other=b.request(json!({"op":"register","name":"Other","email":"other@test.local","password":"strong-password"})).unwrap();
        assert!(b.request(json!({"op":"revoke_session","token":s(&other,"token"),"session_id":sessions[1]["id"]})).is_err());
        b.request(json!({"op":"revoke_session","token":ct,"session_id":sessions[1]["id"]}))
            .unwrap();
        assert!(b.authenticate(ct).is_err());
        let c = b.request(login.clone()).unwrap();
        let ct = s(&c, "token");
        assert!(b.request(json!({"op":"change_password","token":ct,"current_password":"wrong","password":"changed-password"})).is_err());
        b.request(json!({"op":"change_password","token":ct,"current_password":"strong-password","password":"changed-password"})).unwrap();
        assert!(b.authenticate(ct).is_err());
        assert!(b.request(login.clone()).is_err());
        login["password"] = json!("changed-password");
        let c = b.request(login).unwrap();
        let ct = s(&c, "token");
        b.db["sessions"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|x| x["token_hash"] == token_hash(ct))
            .unwrap()["expires_at"] = json!(now() - 1);
        assert!(b.authenticate(ct).is_err());
        b.db.as_object_mut().unwrap().remove("sessions");
        b.save().unwrap();
        drop(b);
        let b = Backend::open(path.clone()).unwrap();
        assert!(b.db["sessions"].is_array());
        assert!(b.authenticate(ct).is_err());
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn auth_privacy_persistence() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let a=b.request(json!({"op":"register","name":"Alice","email":"a@test.local","password":"a-strong-password"})).unwrap();
        let c=b.request(json!({"op":"register","name":"Carol","email":"c@test.local","password":"another-password"})).unwrap();
        let at = s(&a, "token");
        let ct = s(&c, "token");
        assert!(b
            .request(json!({"op":"state","token":format!("{at}x")}))
            .is_err());
        assert!(b
            .request(json!({"op":"login","email":"a@test.local","password":"wrong-password"}))
            .is_err());
        assert!(b.request(json!({"op":"register","name":"Duplicate","email":"A@test.local","password":"another-password"})).is_err());
        b.request(json!({"op":"create_group","token":at,"name":"Private"}))
            .unwrap();
        let state = b.request(json!({"op":"state","token":at})).unwrap();
        let channel = &state["groups"][0]["channels"][0]["id"];
        assert!(b
            .request(json!({"op":"message","token":ct,"channel":channel,"text":"intrusion"}))
            .is_err());
        assert!(b.request(json!({"op":"create_channel","token":ct,"group":state["groups"][0]["id"],"name":"intrusion"})).is_err());
        b.request(json!({"op":"message","token":at,"channel":channel,"text":"secret"}))
            .unwrap();
        assert!(arr(&b.request(json!({"op":"state","token":ct})).unwrap()["messages"]).is_empty());
        let d = b
            .request(json!({"op":"create_dialog","token":at,"members":[c["user"]["id"]]}))
            .unwrap();
        let d2 = b
            .request(json!({"op":"create_dialog","token":ct,"members":[a["user"]["id"]]}))
            .unwrap();
        assert_eq!(d["id"], d2["id"]);
        b.request(json!({"op":"message","token":ct,"channel":d["id"],"text":"hello"}))
            .unwrap();
        drop(b);
        let mut b = Backend::open(path.clone()).unwrap();
        assert_eq!(
            arr(&b.request(json!({"op":"state","token":at})).unwrap()["messages"]).len(),
            2
        );
        b.request(json!({"op":"logout","token":at})).unwrap();
        assert!(b.request(json!({"op":"state","token":at})).is_err());
        assert!(b.authenticate("invalid").is_err());
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}

pub(crate) fn api_router(backend: Backend) -> axum::Router {
    use axum::{
        extract::{rejection::JsonRejection, State},
        http::{HeaderMap, StatusCode},
        response::{IntoResponse, Response},
        routing::{get, post},
        Json, Router,
    };

    #[derive(Clone)]
    struct ApiState {
        backend: Arc<Mutex<Backend>>,
        diagnostics: Arc<diagnostics::Diagnostics>,
    }

    fn response(status: StatusCode, body: Value) -> Response {
        (status, [("cache-control", "no-store")], Json(body)).into_response()
    }

    async fn request(
        State(state): State<ApiState>,
        headers: HeaderMap,
        body: Result<Json<Value>, JsonRejection>,
    ) -> Response {
        if headers
            .get("sec-fetch-site")
            .and_then(|header| header.to_str().ok())
            == Some("cross-site")
        {
            state.diagnostics.server("unknown", 403, "cross_site");
            return response(StatusCode::FORBIDDEN, json!({"error": "Доступ запрещён"}));
        }
        let mut request = match body {
            Ok(Json(request)) if request.is_object() => request,
            invalid => {
                let status = invalid
                    .err()
                    .map_or(StatusCode::BAD_REQUEST, |error| error.status());
                state
                    .diagnostics
                    .server("unknown", status.as_u16(), "invalid_request");
                return response(status, json!({"error": "Некорректный запрос"}));
            }
        };
        let cookie = headers
            .get("cookie")
            .and_then(|header| header.to_str().ok())
            .unwrap_or("");
        request["token"] = json!(cookie
            .split(';')
            .map(str::trim)
            .find_map(|cookie| cookie.strip_prefix("mines_session="))
            .unwrap_or(""));
        request["bot_token"] = json!(headers
            .get("authorization")
            .and_then(|header| header.to_str().ok())
            .and_then(|header| header.strip_prefix("Bearer "))
            .unwrap_or(""));
        let operation = diagnostics::operation(s(&request, "op"));
        let starts_session = matches!(operation, "login" | "register");
        if starts_session {
            request["device"] = json!(headers
                .get("user-agent")
                .and_then(|header| header.to_str().ok())
                .unwrap_or("Browser"));
        }
        let max_age = session_lifetime(request["remember_me"].as_bool().unwrap_or(false));
        let result = if operation == "music_stream_chunk" {
            let prepare = || {
                state
                    .backend
                    .lock()
                    .map_err(|_| "STORAGE_UNAVAILABLE".to_string())?
                    .prepare_music_chunk(&request)
            };
            Ok(match prepare() {
                Ok((helper, provider_id, offset)) => {
                    match helper.read(&provider_id, offset).await {
                        // A skip, expiry, or voice leave during the upstream read
                        // must not release the bytes to a now-unauthorized caller.
                        Ok(data) => prepare().map(|_| data),
                        Err(error) => Err(error),
                    }
                }
                Err(error) => Err(error),
            })
        } else if operation == "music_command" && request["action"] == "add" {
            // Never hold the backend mutex during a provider lookup. Authenticate and
            // check the voice lease again before writing the resulting tracks.
            let prepare = || -> Result<_, String> {
                state
                    .backend
                    .lock()
                    .map_err(|_| "STORAGE_UNAVAILABLE")?
                    .prepare_music_add(&request)
            };
            match prepare() {
                Ok(Some((helper, input, limit))) => Ok(match helper.resolve(input, limit).await {
                    Ok(tracks) => state
                        .backend
                        .lock()
                        .map_err(|_| "STORAGE_UNAVAILABLE".to_string())
                        .and_then(|mut backend| backend.finish_music_add(&request, tracks)),
                    Err(error) => Err(error),
                }),
                Ok(None) => {
                    tokio::task::spawn_blocking(move || {
                        state
                            .backend
                            .lock()
                            .map_err(|_| "STORAGE_UNAVAILABLE")?
                            .request(request)
                    })
                    .await
                }
                Err(error) => Ok(Err(error)),
            }
        } else {
            tokio::task::spawn_blocking(move || {
                state
                    .backend
                    .lock()
                    .map_err(|_| "STORAGE_UNAVAILABLE".to_string())?
                    .request(request)
            })
            .await
        };
        let (status, category, error) = match result {
            Ok(Ok(mut data)) => {
                let cookie = if starts_session {
                    let cookie = data.get("token").and_then(Value::as_str).map(|token| {
                        format!("mines_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}")
                    });
                    data.as_object_mut().unwrap().remove("token");
                    cookie
                } else if matches!(operation, "logout" | "logout_all" | "change_password") {
                    Some("mines_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0".into())
                } else {
                    None
                };
                state.diagnostics.server(operation, 200, "ok");
                let mut response = response(StatusCode::OK, json!({"data": data}));
                if let Some(mut cookie) = cookie {
                    if std::env::var("MINES_SECURE_COOKIE").as_deref() == Ok("1") {
                        cookie.push_str("; Secure");
                    }
                    response
                        .headers_mut()
                        .insert("set-cookie", cookie.parse().unwrap());
                }
                return response;
            }
            Ok(Err(error)) => match error.as_str() {
                "AUTH_REQUIRED" => (StatusCode::UNAUTHORIZED, "authentication", error),
                "PROFILE_EFFECT_DRAFT_FORBIDDEN" | "PROFILE_EFFECT_DRAFT_DISABLED" =>
                    (StatusCode::FORBIDDEN, "authorization", error),
                "PROFILE_EFFECT_DRAFT_NOT_FOUND" => (StatusCode::NOT_FOUND, "validation", error),
                "PROFILE_EFFECT_DRAFT_CONFLICT" => (StatusCode::CONFLICT, "validation", error),
                "PROFILE_EFFECT_DRAFT_LIMIT" => (StatusCode::TOO_MANY_REQUESTS, "rate_limit", error),
                "Нет доступа к изменению диалога" | "Нет доступа к участникам переписки" => (StatusCode::FORBIDDEN, "authorization", error),
                "Диалог изменён. Обновите данные и повторите попытку" => (StatusCode::CONFLICT, "validation", error),
                "MUSIC_ROOM_FORBIDDEN" | "MUSIC_VOICE_REQUIRED" =>
                    (StatusCode::FORBIDDEN, "authorization", error),
                "MUSIC_FILE_NOT_AVAILABLE" => (StatusCode::NOT_FOUND, "validation", error),
                "MUSIC_STREAM_INVALID_OFFSET" => (StatusCode::RANGE_NOT_SATISFIABLE, "validation", error),
                "MUSIC_STREAM_UNAVAILABLE" => (StatusCode::BAD_GATEWAY, "upstream", error),
                "MUSIC_STREAM_TIMEOUT" => (StatusCode::GATEWAY_TIMEOUT, "upstream", error),
                "MUSIC_STREAM_BUSY" => (StatusCode::TOO_MANY_REQUESTS, "rate_limit", error),
                "MESSAGE_READ_FORBIDDEN"
                | "BOT_SETTINGS_FORBIDDEN"
                | "BOT_POLICY_FORBIDDEN"
                | "BOT_DECORATION_FORBIDDEN" | "PROFILE_EFFECT_FORBIDDEN" => {
                    (StatusCode::FORBIDDEN, "authorization", error)
                },
                "PROFILE_EFFECT_NOT_FOUND" => (StatusCode::NOT_FOUND, "authorization", error),
                "DIAGNOSTICS_FORBIDDEN" => (
                    StatusCode::FORBIDDEN,
                    "authorization",
                    "Доступ к журналу есть только у владельца сервера".into(),
                ),
                "DIAGNOSTICS_RATE_LIMIT" => (
                    StatusCode::TOO_MANY_REQUESTS,
                    "rate_limit",
                    "Лимит диагностических отчётов".into(),
                ),
                "STORAGE_UNAVAILABLE" | "Изображение стикера недоступно" => {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "storage",
                        "Данные временно недоступны".into(),
                    )
                }
                "DIAGNOSTICS_UNAVAILABLE" | "Invalid password hash" => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    "Ошибка сервера".into(),
                ),
                _ => (StatusCode::BAD_REQUEST, "request_rejected", error),
            },
            Err(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                "Ошибка сервера".into(),
            ),
        };
        state
            .diagnostics
            .server(operation, status.as_u16(), category);
        response(status, json!({"error": error}))
    }

    let state = ApiState {
        diagnostics: Arc::clone(&backend.diagnostics),
        backend: Arc::new(Mutex::new(backend)),
    };
    // Weak ownership makes the maintenance task stop when the router is dropped.
    if let Ok(runtime) = tokio::runtime::Handle::try_current() {
        let backend = Arc::downgrade(&state.backend);
        runtime.spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                interval.tick().await;
                let Some(backend) = backend.upgrade() else {
                    break;
                };
                if let Ok(mut backend) = backend.lock() {
                    backend.cleanup_calls(now());
                };
            }
        });
    }
    Router::new()
        .route("/api", post(request))
        .route("/health", get(|| async { "Mines ready" }))
        .layer(axum::extract::DefaultBodyLimit::max(15 * 1024 * 1024))
        .with_state(state)
}

pub async fn serve(backend: Backend) -> Result<(), Box<dyn std::error::Error>> {
    let bind = std::env::var("MINES_BIND").unwrap_or("127.0.0.1:3847".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    axum::serve(listener, api_router(backend)).await?;
    Ok(())
}

#[cfg(test)]
mod remember_tests {
    use super::*;
    #[test]
    fn remembered_session_survives_inactivity_until_year_boundary() {
        let path = std::env::temp_dir()
            .join(format!("mines-remember-{}", id()))
            .join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let a=b.request(json!({"op":"register","email":"remember@test.local","name":"Remember","password":"strong-password","remember_me":true})).unwrap();
        let t = s(&a, "token");
        let row = b.db["sessions"][0].clone();
        let start = row["created_at"].as_u64().unwrap();
        assert_eq!(row["expires_at"].as_u64().unwrap() - start, YEAR_SECONDS);
        assert!(session_active(&row, start + YEAR_SECONDS - 1));
        assert!(!session_active(&row, start + YEAR_SECONDS));
        drop(b);
        let mut b = Backend::open(path.clone()).unwrap();
        assert!(b.authenticate(t).is_ok());
        let normal = b
            .request(
                json!({"op":"login","email":"remember@test.local","password":"strong-password"}),
            )
            .unwrap();
        let row = b.db["sessions"][1].clone();
        let start = row["created_at"].as_u64().unwrap();
        assert_eq!(row["expires_at"].as_u64().unwrap() - start, 2592000);
        assert!(!session_active(&row, start + 604800));
        assert!(b.authenticate(s(&normal, "token")).is_ok());
        assert_eq!(
            arr(&b.request(json!({"op":"sessions","token":t})).unwrap()).len(),
            2
        );
        b.request(json!({"op":"logout","token":t})).unwrap();
        assert!(b.authenticate(t).is_err());
        std::fs::remove_file(path).unwrap();
    }
}
#[cfg(test)]
mod diagnostics_tests {
    use super::*;

    #[tokio::test]
    async fn diagnostics_http_uses_cookie_and_records_safe_errors() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut backend = Backend::open(path.clone()).unwrap();
        let owner = backend.db["users"][0].clone();
        let owner_token = backend.token(&owner, "owner test", false).unwrap();
        let guest = backend
            .request(
                json!({"op": "register", "email": "diagnostics@example.test",
            "name": "Guest", "password": "strong-password"}),
            )
            .unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/api", listener.local_addr().unwrap());
        let server =
            tokio::spawn(async move { axum::serve(listener, api_router(backend)).await.unwrap() });
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::new();
        let recent = json!({"op": "diagnostics_recent", "token": owner_token});
        let guest_cookie = format!("mines_session={}", guest["token"].as_str().unwrap());
        let owner_cookie = format!("mines_session={owner_token}");

        let unauthenticated = client.post(&url).json(&recent).send().await.unwrap();
        assert_eq!(unauthenticated.status(), 401);
        let forbidden = client
            .post(&url)
            .header("cookie", &guest_cookie)
            .json(&recent)
            .send()
            .await
            .unwrap();
        assert_eq!(forbidden.status(), 403);

        let malformed = client
            .post(&url)
            .header("content-type", "application/json")
            .body("{\"password\":\"private field\"")
            .send()
            .await
            .unwrap();
        assert_eq!(malformed.status(), 400);
        let unknown = client
            .post(&url)
            .header("cookie", &owner_cookie)
            .json(&json!({"op": "private operation"}))
            .send()
            .await
            .unwrap();
        assert_eq!(unknown.status(), 400);
        std::fs::create_dir(path.with_extension("tmp")).unwrap();
        let failed_save = client
            .post(&url)
            .header("cookie", &owner_cookie)
            .json(&json!({"op": "create_group", "name": "private group"}))
            .send()
            .await
            .unwrap();
        assert_eq!(failed_save.status(), 500);
        let response = client
            .post(&url)
            .header("cookie", &owner_cookie)
            .json(&recent)
            .send()
            .await
            .unwrap();
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body = response.text().await.unwrap();
        assert!(!body.contains("private"));
        assert!(!body.contains(&owner_token));
        let result: Value = serde_json::from_str(&body).unwrap();
        let events = result["data"]["events"].as_array().unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0]["category"], "invalid_request");
        assert_eq!(events[1]["operation"], "unknown");
        assert_eq!(events[2]["category"], "storage");
        assert_eq!(events[2]["status"], 500);
        server.abort();
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn diagnostics_require_owner_and_keep_only_safe_report_fields() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut backend = Backend::open(path.clone()).unwrap();
        let owner = backend.db["users"][0].clone();
        let owner_token = backend.token(&owner, "owner secret", false).unwrap();
        let guest = backend.request(json!({
            "op": "register", "email": "guest@example.test", "name": "Guest", "password": "strong-password"
        })).unwrap();
        let recent = json!({"op": "diagnostics_recent", "token": owner_token});
        assert_eq!(
            backend
                .request(json!({"op": "diagnostics_recent"}))
                .unwrap_err(),
            "AUTH_REQUIRED"
        );
        assert!(backend
            .request(json!({"op": "diagnostics_recent", "token": guest["token"]}))
            .is_err());

        let report = json!({
            "op": "diagnostics_report", "token": guest["token"],
            "events": [{"operation": "voice_poll", "category": "transport", "status": null,
                        "message": "private message", "token": "private token"}]
        });
        let mut unauthenticated = report.clone();
        unauthenticated["token"] = json!("");
        assert_eq!(
            backend.request(unauthenticated).unwrap_err(),
            "AUTH_REQUIRED"
        );
        backend.request(report.clone()).unwrap();
        let mut invalid = report;
        invalid["events"][0]["operation"] = json!("private password");
        assert!(backend.request(invalid).is_err());

        let events = backend.request(recent).unwrap()["events"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(events.len(), 1);
        let mut event = events[0].clone();
        assert!(event
            .as_object_mut()
            .unwrap()
            .remove("time")
            .unwrap()
            .is_u64());
        assert_eq!(
            event,
            json!({"source": "desktop", "operation": "voice_poll", "category": "transport", "status": null})
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
#[cfg(test)]
mod voice_tests {
    use super::*;
    #[test]
    fn room_membership_signals_and_cleanup() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let owner = b.db["users"][0].clone();
        let token = b.token(&owner, "test", false).unwrap();
        let room = b.db["groups"][0]["channels"][4]["id"].clone();
        let outsider=b.request(json!({"op":"register","name":"Other","email":"voice@test.local","password":"strong-password"})).unwrap();
        let a = id();
        let c = id();
        assert!(b
            .request(json!({"op":"voice_join","token":outsider["token"],"room":room,"client":a}))
            .is_err());
        b.request(json!({"op":"voice_join","token":token,"room":room,"client":a}))
            .unwrap();
        b.request(json!({"op":"voice_join","token":token,"room":room,"client":c}))
            .unwrap();
        let roster = b.request(json!({"op":"state","token":token})).unwrap();
        assert_eq!(
            roster["voicePresence"][room.as_str().unwrap()],
            json!([{"user":owner["id"],"muted":false,"deaf":false}])
        );
        assert_eq!(
            b.request(json!({"op":"state","token":outsider["token"]}))
                .unwrap()["voicePresence"],
            json!({})
        );
        b.request(json!({"op":"voice_signal","token":token,"room":room,"client":a,"target":c,"payload":{"description":{"type":"offer","sdp":"test"}}})).unwrap();
        let poll = b
            .request(json!({"op":"voice_poll","token":token,"room":room,"client":c}))
            .unwrap();
        assert_eq!(arr(&poll["peers"]).len(), 2);
        assert_eq!(arr(&poll["signals"]).len(), 1);
        assert!(!poll["peers"].to_string().contains("session"));
        assert!(arr(&b.request(json!({"op":"voice_poll","token":token,"room":room,"client":c,"after":poll["cursor"]})).unwrap()["signals"]).is_empty());
        b.request(json!({"op":"voice_leave","token":token,"room":room,"client":a}))
            .unwrap();
        assert!(b.request(json!({"op":"voice_signal","token":token,"room":room,"client":a,"target":c,"payload":{}})).is_err());
        b.voice[0]["seen"] = json!(now() - 21);
        assert!(b
            .request(json!({"op":"voice_poll","token":token,"room":room,"client":c}))
            .is_err());
        assert_eq!(
            b.request(json!({"op":"state","token":token})).unwrap()["voicePresence"],
            json!({})
        );
        drop(b);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}

#[cfg(test)]
mod social_tests {
    use super::*;
    #[test]
    fn reactions_stickers_friends_and_scoped_bots() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let owner = b.db["users"][0].clone();
        let token = b.token(&owner, "test", false).unwrap();
        let channel = b.db["groups"][0]["channels"][0]["id"].clone();
        let uid = owner["id"].clone();
        let guest=b.request(json!({"op":"register","name":"Guest","email":"social@test.local","password":"strong-password"})).unwrap();
        let gt = guest["token"].clone();
        let gid = guest["user"]["id"].clone();
        b.request(json!({"op":"message","token":token,"channel":channel,"text":"hello"}))
            .unwrap();
        let mid = b.db["messages"][0]["id"].clone();
        assert!(b
            .request(json!({"op":"reaction","token":gt,"message":mid,"emoji":"👍"}))
            .is_err());
        b.request(json!({"op":"reaction","token":token,"message":mid,"emoji":"👍"}))
            .unwrap();
        assert_eq!(arr(&b.db["messages"][0]["reactions"]).len(), 1);
        b.request(json!({"op":"reaction","token":token,"message":mid,"emoji":"👍"}))
            .unwrap();
        assert!(arr(&b.db["messages"][0]["reactions"]).is_empty());
        let image="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
        let st = b
            .request(json!({"op":"create_sticker","token":token,"name":"Test","image":image}))
            .unwrap();
        assert!(b.request(json!({"op":"create_sticker","token":token,"name":"bad","image":"data:image/png;base64,aGVsbG8="})).is_err());
        assert!(b
            .request(json!({"op":"message","token":gt,"channel":channel,"sticker":st["id"]}))
            .is_err());
        b.request(json!({"op":"message","token":token,"channel":channel,"sticker":st["id"]}))
            .unwrap();
        b.request(json!({"op":"friend_request","token":token,"user":gid}))
            .unwrap();
        let fid = b.db["friends"][0]["id"].clone();
        assert!(b
            .request(json!({"op":"friend_accept","token":token,"id":fid}))
            .is_err());
        b.request(json!({"op":"friend_accept","token":gt,"id":fid}))
            .unwrap();
        assert!(b
            .request(json!({"op":"create_bot","token":gt,"channel":channel,"name":"bad"}))
            .is_err());
        let bot = b
            .request(json!({"op":"create_bot","token":token,"channel":channel,"name":"Helper"}))
            .unwrap();
        let bt = bot["token"].clone();
        b.request(
            json!({"op":"bot_message","bot_token":bt,"channel":"ignored","text":"bot reply"}),
        )
        .unwrap();
        let poll = b.request(json!({"op":"bot_poll","bot_token":bt})).unwrap();
        assert_eq!(arr(&poll["messages"]).len(), 3);
        assert_eq!(poll["messages"][2]["channel"], channel);
        assert!(b.request(json!({"op":"state","token":bt})).is_err());
        assert!(!b.state(&owner, false).to_string().contains("token_hash"));
        assert!(!std::fs::read_to_string(&path)
            .unwrap()
            .contains(bt.as_str().unwrap()));
        drop(b);
        let mut b = Backend::open(path.clone()).unwrap();
        assert_eq!(b.db["friends"][0]["accepted"], true);
        assert_eq!(b.db["stickers"][0]["id"], st["id"]);
        assert_eq!(b.db["friends"][0]["from"], uid);
        let bid = b.db["bots"][0]["id"].clone();
        b.request(json!({"op":"delete_bot","token":token,"id":bid}))
            .unwrap();
        assert!(b.request(json!({"op":"bot_poll","bot_token":bt})).is_err());
        drop(b);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
