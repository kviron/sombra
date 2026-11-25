use super::{id, s, Backend};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use std::{fs, io::Read, path::Path};

const MAX_QUEUE: usize = 1000;
const DEFAULT_ADD_LIMIT: usize = 32;

fn music_add_limit(request: &Value) -> Result<usize, String> {
    match request.get("limit") {
        None => Ok(DEFAULT_ADD_LIMIT),
        Some(limit) => limit
            .as_u64()
            .filter(|&n| (1..=MAX_QUEUE as u64).contains(&n))
            .map(|n| n as usize)
            .ok_or_else(|| "MUSIC_INVALID_LIMIT".into()),
    }
}
const MAX_URL_BYTES: usize = 2048;

// Provider metadata is resolved only through the configured localhost helper.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover_url: Option<String>,
    url: String,
    duration_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Track {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    asset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
    #[serde(skip)]
    provider_id: Option<String>,
    #[serde(flatten)]
    source: Source,
}

fn yandex(url: &Url) -> bool {
    let Some(host) = url.domain() else {
        return false;
    };
    let host = host.trim_end_matches('.');
    host.starts_with("music.yandex.") || host == "music.ya.ru"
}

fn approved_origin(url: &Url) -> bool {
    url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && !yandex(url)
        && match url.scheme() {
            "https" => true,
            "http" => loopback(url),
            _ => false,
        }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogEntry {
    title: String,
    url: String,
    duration_ms: u64,
    #[serde(default, deserialize_with = "deserialize_input_url")]
    input_url: Option<String>,
}

fn deserialize_input_url<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}

fn loopback(url: &Url) -> bool {
    url.host_str().is_some_and(|host| {
        host == "localhost"
            || host
                .trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    })
}

fn yandex_path(input: &str) -> Option<(String, &str)> {
    // Check the raw authority/path before the URL parser can fold encoded hosts,
    // backslashes or dot segments. Ignore share-query parameters, not fragments.
    if input.len() > MAX_URL_BYTES
        || input
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
        || input.contains(['#', '\\'])
    {
        return None;
    }
    let (scheme, rest) = input.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("https") {
        return None;
    }
    let (authority, path) = rest.split('?').next()?.split_once('/')?;
    let authority = authority.to_ascii_lowercase();
    if !matches!(
        authority.as_str(),
        "music.yandex.ru" | "music.yandex.com" | "music.ya.ru"
    ) {
        return None;
    }
    let path = path.strip_suffix('/').unwrap_or(path);
    Some((authority, path))
}

fn provider_number(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 19
        && value.bytes().all(|b| b.is_ascii_digit())
        && value
            .parse::<u64>()
            .is_ok_and(|n| n > 0 && n.to_string() == value)
}

fn yandex_track_key(input: &str) -> Option<String> {
    let (authority, path) = yandex_path(input)?;
    match path.split('/').collect::<Vec<_>>().as_slice() {
        ["track", track] if provider_number(track) => (),
        ["album", album, "track", track] if provider_number(album) && provider_number(track) => (),
        _ => return None,
    }
    Some(format!("{authority}/{path}"))
}

pub(super) enum YandexInput {
    Track(String),
    Playlist(String),
    UserPlaylist { owner: String, kind: String },
}

impl YandexInput {
    fn parse(input: &str) -> Option<Self> {
        let (_, path) = yandex_path(input)?;
        match path.split('/').collect::<Vec<_>>().as_slice() {
            ["track", id] if provider_number(id) => Some(Self::Track((*id).into())),
            ["album", album, "track", id] if provider_number(album) && provider_number(id) => {
                Some(Self::Track((*id).into()))
            }
            ["playlists", id] => {
                let uuid = id.strip_prefix("lk.").unwrap_or(id);
                if uuid.len() != 36
                    || !uuid::Uuid::parse_str(uuid)
                        .is_ok_and(|u| !u.is_nil() && u.to_string().eq_ignore_ascii_case(uuid))
                {
                    return None;
                }
                Some(Self::Playlist(id.to_ascii_lowercase()))
            }
            ["users", owner, "playlists", kind]
                if !owner.is_empty()
                    && owner.len() <= 64
                    && owner
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
                    && !matches!(*owner, "." | "..")
                    && provider_number(kind) =>
            {
                Some(Self::UserPlaylist {
                    owner: (*owner).into(),
                    kind: (*kind).into(),
                })
            }
            _ => None,
        }
    }
}

#[derive(Default)]
struct Catalog {
    sources: HashMap<String, Source>,
    aliases: HashMap<String, String>,
}

impl Catalog {
    fn parse(raw: &str) -> Result<Self, String> {
        let invalid = || "Invalid MINES_MUSIC_TEST_CATALOG".to_string();
        if raw.len() > 128 * 1024 {
            return Err(invalid());
        }
        let entries: Vec<CatalogEntry> = serde_json::from_str(raw).map_err(|_| invalid())?;
        let mut catalog = Self::default();
        if entries.len() > 64 {
            return Err(invalid());
        }
        for entry in entries {
            if entry.title.trim().is_empty()
                || entry.title.chars().count() > 120
                || entry.url.len() > MAX_URL_BYTES
                || !(1..=24 * 60 * 60 * 1000).contains(&entry.duration_ms)
                || catalog.sources.contains_key(&entry.url)
            {
                return Err(invalid());
            }
            let url = Url::parse(&entry.url).map_err(|_| invalid())?;
            if !approved_origin(&url) {
                return Err(invalid());
            }
            if let Some(input) = entry.input_url {
                let key = yandex_track_key(&input)
                    .filter(|_| loopback(&url))
                    .ok_or_else(invalid)?;
                if catalog.aliases.insert(key, entry.url.clone()).is_some() {
                    return Err(invalid());
                }
            }
            catalog.sources.insert(
                entry.url.clone(),
                Source {
                    title: entry.title,
                    artist: None,
                    cover_url: None,
                    url: entry.url,
                    duration_ms: entry.duration_ms,
                },
            );
        }
        Ok(catalog)
    }

    fn resolve(&self, input: &str) -> Result<Track, String> {
        if input.is_empty() || input.len() > MAX_URL_BYTES {
            return Err("MUSIC_INVALID_URL".into());
        }
        let url = Url::parse(input).map_err(|_| "MUSIC_INVALID_URL")?;
        let source = if yandex(&url) {
            yandex_track_key(input)
                .and_then(|key| self.aliases.get(&key))
                .and_then(|media| self.sources.get(media))
                .ok_or("MUSIC_PROVIDER_NOT_CONFIGURED")?
        } else {
            self.sources.get(input).ok_or("MUSIC_SOURCE_NOT_APPROVED")?
        };
        Ok(Track {
            id: id(),
            asset_id: None,
            stream: None,
            provider_id: None,
            source: source.clone(),
        })
    }
}

#[derive(Default)]
struct Playback {
    revision: u64,
    track: Option<Track>,
    queue: VecDeque<Track>,
    // Stored position at the start of the current playing interval, or at pause.
    offset_ms: u64,
    running_since: Option<Instant>,
}

fn system_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn elapsed_ms(start: Instant, end: Instant) -> u64 {
    end.saturating_duration_since(start).as_millis() as u64
}

impl Playback {
    fn available(&self) -> usize {
        MAX_QUEUE - self.queue.len() + usize::from(self.track.is_none())
    }

    fn position(&self, at: Instant) -> u64 {
        self.offset_ms + self.running_since.map_or(0, |start| elapsed_ms(start, at))
    }

    fn start(&mut self, track: Option<Track>, at: Instant) {
        self.running_since = track.as_ref().map(|_| at);
        self.offset_ms = 0;
        self.track = track;
        self.revision += 1;
    }

    fn advance(&mut self, at: Instant) {
        let Some(start) = self.running_since else {
            return;
        };
        let mut position = self.position(at);
        let mut transition = start;
        while let Some(track) = &self.track {
            let duration = track.source.duration_ms;
            if position < duration {
                break;
            }
            position -= duration;
            transition += std::time::Duration::from_millis(duration - self.offset_ms);
            let next = self.queue.pop_front();
            self.start(next, transition);
        }
    }

    fn command(&mut self, action: &str, track: Option<Track>, at: Instant) -> Result<(), String> {
        match action {
            "add" => {
                let track = track.ok_or("MUSIC_INVALID_URL")?;
                if self.track.is_none() {
                    self.start(Some(track), at);
                } else {
                    if self.queue.len() >= MAX_QUEUE {
                        return Err("MUSIC_QUEUE_FULL".into());
                    }
                    self.queue.push_back(track);
                    self.revision += 1;
                }
            }
            "pause" if self.running_since.is_some() => {
                self.offset_ms = self.position(at);
                self.running_since = None;
                self.revision += 1;
            }
            "resume" if self.track.is_some() && self.running_since.is_none() => {
                self.running_since = Some(at);
                self.revision += 1;
            }
            "skip" if self.track.is_some() => {
                let next = self.queue.pop_front();
                self.start(next, at);
            }
            "stop" if self.track.is_some() => {
                self.queue.clear();
                self.start(None, at);
            }
            "shuffle" if self.queue.len() > 1 => {
                use ring::rand::SecureRandom;
                let mut random = vec![0; 4 * (self.queue.len() - 1)];
                ring::rand::SystemRandom::new()
                    .fill(&mut random)
                    .map_err(|_| "MUSIC_SHUFFLE_FAILED")?;
                for (index, bytes) in (1..self.queue.len()).rev().zip(random.chunks_exact(4)) {
                    let choice = u32::from_le_bytes(bytes.try_into().unwrap()) as usize % (index + 1);
                    self.queue.swap(index, choice);
                }
                self.revision += 1;
            }
            "pause" | "resume" | "skip" | "stop" | "shuffle" => (),
            _ => return Err("MUSIC_INVALID_ACTION".into()),
        }
        Ok(())
    }

    fn state(&self, room: &str, at: Instant, time_ms: u64) -> Value {
        let status = if self.track.is_none() {
            "idle"
        } else if self.running_since.is_some() {
            "playing"
        } else {
            "paused"
        };
        json!({"room":room,"revision":self.revision,"serverTimeMs":time_ms,"positionMs":self.position(at),"status":status,"track":self.track,"queue":self.queue})
    }
}

const PRIVATE_CONFIG_ERROR: &str = "Invalid MINES_MUSIC_PRIVATE_TRACK configuration";
const MAX_PRIVATE_CONFIG: u64 = 8 * 1024;
const MAX_PRIVATE_AUDIO: u64 = 10 * 1024 * 1024;
const APPROVED_ROOM: &str = "cd1f4fa5-09b9-472e-8826-7ca5b981e187";
const APPROVED_KEY: &str = "music.yandex.ru/album/5071484/track/39312848";
#[cfg(test)]
const PROVIDER_ID: &str = "39312848";
// Allow 1000 validated titles (up to 120 Unicode characters each), even
// when encoded as JSON surrogate pairs, with bounded room for other fields.
const RESOLVE_BYTES_PER_TRACK: usize = 1536;
const CHUNK_BYTES: u64 = 256 * 1024;
const MAX_STREAM_AUDIO: u64 = 10 * 1024 * 1024;
const STREAM_CONFIG_ERROR: &str = "Invalid MINES_MUSIC_STREAM_HELPER configuration";
const STREAM_UNAVAILABLE: &str = "MUSIC_STREAM_UNAVAILABLE";
const STREAM_OFFSET: &str = "MUSIC_STREAM_INVALID_OFFSET";

#[derive(Clone)]
pub(super) struct StreamHelper {
    endpoint: Url,
    client: reqwest::Client,
    inflight: Arc<tokio::sync::Semaphore>,
    resolving: Arc<tokio::sync::Semaphore>,
}

impl StreamHelper {
    fn configured(raw: &str) -> Result<Self, String> {
        let endpoint = Url::parse(raw).map_err(|_| STREAM_CONFIG_ERROR)?;
        let port = endpoint.port().ok_or(STREAM_CONFIG_ERROR)?;
        if port == 0 || raw != format!("http://127.0.0.1:{port}/chunk") {
            return Err(STREAM_CONFIG_ERROR.into());
        }
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(1))
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|_| STREAM_CONFIG_ERROR)?;
        Ok(Self {
            endpoint,
            client,
            inflight: Arc::new(tokio::sync::Semaphore::new(8)),
            resolving: Arc::new(tokio::sync::Semaphore::new(2)),
        })
    }

    pub(super) async fn resolve(
        &self,
        input: YandexInput,
        limit: usize,
    ) -> Result<Vec<Track>, String> {
        let _permit = self
            .resolving
            .try_acquire()
            .map_err(|_| "MUSIC_STREAM_BUSY")?;
        let mut url = self.endpoint.clone();
        url.set_path("/resolve");
        {
            let mut query = url.query_pairs_mut();
            match &input {
                YandexInput::Track(id) => {
                    query.append_pair("id", id);
                }
                YandexInput::Playlist(id) => {
                    query.append_pair("playlist", id);
                }
                YandexInput::UserPlaylist { owner, kind } => {
                    query.append_pair("owner", owner).append_pair("kind", kind);
                }
            }
            query.append_pair("limit", &limit.to_string());
        }
        let mut response = self
            .client
            .get(url)
            .timeout(Duration::from_secs(18))
            .send()
            .await
            .map_err(stream_error)?;
        match response.status() {
            reqwest::StatusCode::OK => (),
            reqwest::StatusCode::NOT_FOUND => return Err("MUSIC_SOURCE_NOT_APPROVED".into()),
            reqwest::StatusCode::TOO_MANY_REQUESTS => return Err("MUSIC_STREAM_BUSY".into()),
            _ => return Err(STREAM_UNAVAILABLE.into()),
        }
        let max_bytes = limit * RESOLVE_BYTES_PER_TRACK + 32;
        if response
            .content_length()
            .is_some_and(|size| size > max_bytes as u64)
        {
            return Err(STREAM_UNAVAILABLE.into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(stream_error)? {
            if bytes.len() + chunk.len() > max_bytes {
                return Err(STREAM_UNAVAILABLE.into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let Resolved { tracks } = serde_json::from_slice(&bytes).map_err(|_| STREAM_UNAVAILABLE)?;
        if tracks.is_empty() {
            return Err("MUSIC_SOURCE_NOT_APPROVED".into());
        }
        if tracks.len() > limit
            || matches!(&input, YandexInput::Track(id) if tracks.len() != 1 || tracks[0].id != *id)
        {
            return Err(STREAM_UNAVAILABLE.into());
        }
        tracks.into_iter().map(ResolvedTrack::into_track).collect()
    }

    pub(super) async fn read(&self, provider_id: &str, offset: u64) -> Result<Value, String> {
        let _permit = self
            .inflight
            .try_acquire()
            .map_err(|_| "MUSIC_STREAM_BUSY")?;
        let mut url = self.endpoint.clone();
        url.query_pairs_mut()
            .append_pair("id", provider_id)
            .append_pair("offset", &offset.to_string())
            .append_pair("limit", &CHUNK_BYTES.to_string());
        let mut response = self.client.get(url).send().await.map_err(stream_error)?;
        if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            return Err(STREAM_OFFSET.into());
        }
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(STREAM_UNAVAILABLE.into());
        }
        let headers = response.headers();
        use reqwest::header::{CONTENT_ENCODING, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE};
        let header = |name| {
            let mut values = headers.get_all(name).iter();
            let value = values.next()?.to_str().ok()?;
            values.next().is_none().then_some(value)
        };
        if header(CONTENT_TYPE) != Some("audio/mpeg") || headers.contains_key(CONTENT_ENCODING) {
            return Err(STREAM_UNAVAILABLE.into());
        }
        let range = header(CONTENT_RANGE).ok_or(STREAM_UNAVAILABLE)?;
        let (interval, total) = range
            .strip_prefix("bytes ")
            .and_then(|r| r.split_once('/'))
            .ok_or(STREAM_UNAVAILABLE)?;
        let (start, end) = interval.split_once('-').ok_or(STREAM_UNAVAILABLE)?;
        let (start, end, total) = (decimal(start)?, decimal(end)?, decimal(total)?);
        if start != offset || offset >= total || total > MAX_STREAM_AUDIO {
            return Err(STREAM_UNAVAILABLE.into());
        }
        let next = (offset + CHUNK_BYTES).min(total);
        let length = next - offset;
        if end != next - 1 || decimal(header(CONTENT_LENGTH).ok_or(STREAM_UNAVAILABLE)?)? != length
        {
            return Err(STREAM_UNAVAILABLE.into());
        }
        let mut bytes = Vec::with_capacity(length as usize);
        while let Some(chunk) = response.chunk().await.map_err(stream_error)? {
            if bytes.len() + chunk.len() > length as usize {
                return Err(STREAM_UNAVAILABLE.into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.len() != length as usize {
            return Err(STREAM_UNAVAILABLE.into());
        }
        Ok(
            json!({"ok":true,"offset":offset,"nextOffset":next,"totalBytes":total,
            "mime":"audio/mpeg","data":STANDARD.encode(bytes),"eof":next == total}),
        )
    }
}

#[derive(Deserialize)]
struct Resolved {
    tracks: Vec<ResolvedTrack>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedTrack {
    id: String,
    title: String,
    duration_ms: u64,
    artist: Option<String>,
    cover_url: Option<String>,
}

fn music_cover_url(value: &str) -> bool {
    value.len() <= 450 && Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && matches!(url.host_str(), Some("avatars.yandex.net" | "avatars.mds.yandex.net"))
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && url.path().bytes().all(|c| c.is_ascii_alphanumeric() || b"/-._".contains(&c))
    })
}

impl ResolvedTrack {
    fn into_track(self) -> Result<Track, String> {
        let title = self.title.trim();
        if !provider_number(&self.id)
            || title.is_empty()
            || title.chars().count() > 120
            || self.title.chars().any(char::is_control)
            || !(1..=24 * 60 * 60 * 1000).contains(&self.duration_ms)
        {
            return Err(STREAM_UNAVAILABLE.into());
        }
        let id = id();
        Ok(Track {
            asset_id: Some(id.clone()),
            stream: Some(true),
            provider_id: Some(self.id),
            id,
            source: Source {
                title: title.into(),
                artist: self.artist.filter(|value| !value.trim().is_empty()
                    && value.chars().count() <= 120 && !value.chars().any(char::is_control)),
                cover_url: self.cover_url.filter(|value| music_cover_url(value)),
                url: String::new(),
                duration_ms: self.duration_ms,
            },
        })
    }
}

fn decimal(raw: &str) -> Result<u64, String> {
    if raw.is_empty() || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err(STREAM_UNAVAILABLE.into());
    }
    raw.parse().map_err(|_| STREAM_UNAVAILABLE.into())
}

fn stream_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "MUSIC_STREAM_TIMEOUT"
    } else {
        STREAM_UNAVAILABLE
    }
    .into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrivateConfig {
    room_id: String,
    input_url: String,
    title: String,
    duration_ms: u64,
}

struct PrivateTrack {
    room: String,
    key: String,
    source: Source,
    base64: String,
}

fn private_metadata(path: &Path, directory: bool) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| PRIVATE_CONFIG_ERROR)?;
    if if directory {
        !metadata.is_dir()
    } else {
        !metadata.is_file()
    } {
        return Err(PRIVATE_CONFIG_ERROR.into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.mode() & 0o027 != 0 || (!directory && metadata.nlink() != 1) {
            return Err(PRIVATE_CONFIG_ERROR.into());
        }
    }
    Ok(metadata)
}

fn read_private(path: &Path, max: u64) -> Result<Vec<u8>, String> {
    let metadata = private_metadata(path, false)?;
    if metadata.len() == 0 || metadata.len() > max {
        return Err(PRIVATE_CONFIG_ERROR.into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)
        .map_err(|_| PRIVATE_CONFIG_ERROR)?
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| PRIVATE_CONFIG_ERROR)?;
    if bytes.is_empty() || bytes.len() as u64 > max {
        return Err(PRIVATE_CONFIG_ERROR.into());
    }
    Ok(bytes)
}

impl PrivateTrack {
    fn load(data_dir: &Path) -> Result<Self, String> {
        let dir = data_dir.join("private-music");
        private_metadata(&dir, true)?;
        let config: PrivateConfig =
            serde_json::from_slice(&read_private(&dir.join("track.json"), MAX_PRIVATE_CONFIG)?)
                .map_err(|_| PRIVATE_CONFIG_ERROR)?;
        let room = uuid::Uuid::parse_str(&config.room_id).map_err(|_| PRIVATE_CONFIG_ERROR)?;
        if room.is_nil()
            || room.to_string() != config.room_id
            || config.title.trim().is_empty()
            || config.title.chars().count() > 120
            || config.title.chars().any(char::is_control)
            || !(1..=24 * 60 * 60 * 1000).contains(&config.duration_ms)
        {
            return Err(PRIVATE_CONFIG_ERROR.into());
        }
        let key = yandex_track_key(&config.input_url).ok_or(PRIVATE_CONFIG_ERROR)?;
        let bytes = read_private(&dir.join("track.mp3"), MAX_PRIVATE_AUDIO)?;
        // This is a sanity check, not a decoder: the operator supplies vetted MP3 audio.
        if bytes.len() < 4
            || !(bytes.starts_with(b"ID3") || (bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0))
        {
            return Err(PRIVATE_CONFIG_ERROR.into());
        }
        Ok(Self {
            room: config.room_id,
            key,
            source: Source {
                title: config.title,
                artist: None,
                cover_url: None,
                url: String::new(),
                duration_ms: config.duration_ms,
            },
            base64: STANDARD.encode(bytes),
        })
    }

    fn enqueue(&self) -> Track {
        let id = id();
        Track {
            asset_id: Some(id.clone()),
            stream: None,
            provider_id: None,
            id,
            source: self.source.clone(),
        }
    }
}

#[derive(Default)]
pub(super) struct Music {
    catalog: Catalog,
    private: Option<PrivateTrack>,
    stream: Option<StreamHelper>,
    rooms: HashMap<String, Playback>,
}

impl Music {
    pub(super) fn configured(data_dir: &Path) -> Result<Self, String> {
        let catalog = match std::env::var("MINES_MUSIC_TEST_CATALOG") {
            Ok(raw) => Catalog::parse(&raw)?,
            Err(std::env::VarError::NotPresent) => Catalog::default(),
            Err(_) => return Err("Invalid MINES_MUSIC_TEST_CATALOG".into()),
        };
        // Legacy Yandex aliases used to expose a loopback URL to clients. Do not
        // allow those aliases on the live backend; keep only ordinary test media.
        if !catalog.aliases.is_empty() {
            return Err("Invalid MINES_MUSIC_TEST_CATALOG".into());
        }
        let stream = match std::env::var("MINES_MUSIC_STREAM_HELPER") {
            Ok(raw) => Some(StreamHelper::configured(&raw)?),
            Err(std::env::VarError::NotPresent) => None,
            Err(_) => return Err(STREAM_CONFIG_ERROR.into()),
        };
        let private = if stream.is_none() {
            match std::env::var("MINES_MUSIC_PRIVATE_TRACK").as_deref() {
                Ok("1") => {
                    let track = PrivateTrack::load(data_dir)?;
                    if track.room != APPROVED_ROOM || track.key != APPROVED_KEY {
                        return Err(PRIVATE_CONFIG_ERROR.into());
                    }
                    Some(track)
                }
                Ok("0") | Err(std::env::VarError::NotPresent) => None,
                _ => return Err(PRIVATE_CONFIG_ERROR.into()),
            }
        } else {
            None
        };
        Ok(Self {
            catalog,
            private,
            stream,
            ..Self::default()
        })
    }

    fn resolve(&self, room: &str, group_room: bool, input: &str) -> Result<Track, String> {
        if let Some(private) = &self.private {
            if yandex_track_key(input).as_deref() == Some(private.key.as_str()) {
                if group_room && room == private.room {
                    return Ok(private.enqueue());
                }
                return Err("MUSIC_PROVIDER_NOT_CONFIGURED".into());
            }
        }
        self.catalog.resolve(input)
    }

    fn file(
        &mut self,
        room: &str,
        group_room: bool,
        asset_id: &str,
        at: Instant,
    ) -> Result<Value, String> {
        let unavailable = "MUSIC_FILE_NOT_AVAILABLE";
        let asset = self
            .private
            .as_ref()
            .filter(|p| group_room && room == p.room)
            .ok_or(unavailable)?;
        let playback = self.rooms.get_mut(room).ok_or(unavailable)?;
        playback.advance(at);
        if asset_id.is_empty()
            || !playback
                .track
                .as_ref()
                .is_some_and(|t| t.id == asset_id && t.asset_id.as_deref() == Some(asset_id))
        {
            return Err(unavailable.into());
        }
        Ok(json!({"mime":"audio/mpeg","base64":asset.base64}))
    }

    pub(super) fn cleanup(&mut self, peers: &[Value]) {
        self.rooms
            .retain(|room, _| peers.iter().any(|peer| peer["room"] == room.as_str()));
    }
}

impl Backend {
    pub(super) fn music_action(
        &mut self,
        v: &Value,
        uid: &str,
        session: &str,
    ) -> Result<Value, String> {
        let room = s(v, "room");
        let group_room = self.authorize_music_room(room, uid, session)?;
        let at = Instant::now();
        if v["op"] == "music_file" {
            return self.music.file(room, group_room, s(v, "id"), at);
        }
        let action = if v["op"] == "music_command" {
            Some(s(v, "action"))
        } else {
            None
        };
        let track = if action == Some("add") {
            music_add_limit(v)?;
            Some(self.music.resolve(room, group_room, s(v, "url"))?)
        } else {
            None
        };
        let time_ms = system_time_ms();
        let playback = self.music.rooms.entry(room.to_owned()).or_default();
        playback.advance(at);
        if let Some(action) = action {
            playback.command(action, track, at)?;
        }
        Ok(playback.state(room, at, time_ms))
    }

    fn authorize_music_room(&self, room: &str, uid: &str, session: &str) -> Result<bool, String> {
        let group_room = self.db["groups"].as_array().unwrap().iter().any(|g| {
            g["members"]
                .as_array()
                .is_some_and(|members| members.iter().any(|u| u == uid))
                && g["channels"].as_array().is_some_and(|channels| {
                    channels
                        .iter()
                        .any(|c| c["id"] == room && c["kind"] == "voice")
                })
        });
        let call_room = self
            .dialog_calls
            .iter()
            .any(|call| call["id"] == room && self.dialog_member(uid, s(call, "dialog")));
        if !group_room && !call_room {
            return Err("MUSIC_ROOM_FORBIDDEN".into());
        }
        // Callers prune expired leases before dispatch. Music reads do not
        // extend the voice lease or let another session borrow it.
        if !self
            .voice
            .iter()
            .any(|p| p["room"] == room && p["user"] == uid && p["session"] == session)
        {
            return Err("MUSIC_VOICE_REQUIRED".into());
        }
        Ok(group_room)
    }

    pub(super) fn prepare_music_add(
        &mut self,
        v: &Value,
    ) -> Result<Option<(StreamHelper, YandexInput, usize)>, String> {
        let token = s(v, "token");
        let user = self.authenticate(token)?;
        self.cleanup_calls(super::now());
        let room = s(v, "room");
        let group_room =
            self.authorize_music_room(room, s(&user, "id"), &super::token_hash(token))?;
        let requested = music_add_limit(v)?;
        let Some(input) = YandexInput::parse(s(v, "url")) else {
            return Ok(None);
        };
        let Some(helper) = self.music.stream.clone() else {
            return Ok(None);
        };
        if !group_room || room != APPROVED_ROOM {
            return Err("MUSIC_PROVIDER_NOT_CONFIGURED".into());
        }
        let limit = self
            .music
            .rooms
            .get_mut(room)
            .map_or(requested, |playback| {
                playback.advance(Instant::now());
                playback.available().min(requested)
            });
        if limit == 0 {
            return Err("MUSIC_QUEUE_FULL".into());
        }
        Ok(Some((helper, input, limit)))
    }

    pub(super) fn finish_music_add(
        &mut self,
        v: &Value,
        mut tracks: Vec<Track>,
    ) -> Result<Value, String> {
        let token = s(v, "token");
        let user = self.authenticate(token)?;
        self.cleanup_calls(super::now());
        let room = s(v, "room");
        if !self.authorize_music_room(room, s(&user, "id"), &super::token_hash(token))?
            || room != APPROVED_ROOM
        {
            return Err("MUSIC_ROOM_FORBIDDEN".into());
        }
        let at = Instant::now();
        let playback = self.music.rooms.entry(room.to_owned()).or_default();
        playback.advance(at);
        let capacity = playback.available();
        if capacity == 0 {
            return Err("MUSIC_QUEUE_FULL".into());
        }
        tracks.truncate(capacity);
        for track in tracks {
            playback.command("add", Some(track), at)?;
        }
        Ok(playback.state(room, at, system_time_ms()))
    }

    pub(super) fn prepare_music_chunk(
        &mut self,
        v: &Value,
    ) -> Result<(StreamHelper, String, u64), String> {
        let token = s(v, "token");
        let user = self.authenticate(token)?;
        self.cleanup_calls(super::now());
        let room = s(v, "room");
        let session = super::token_hash(token);
        if !self.authorize_music_room(room, s(&user, "id"), &session)? || room != APPROVED_ROOM {
            return Err("MUSIC_ROOM_FORBIDDEN".into());
        }
        let helper = self
            .music
            .stream
            .as_ref()
            .ok_or("MUSIC_FILE_NOT_AVAILABLE")?;
        let playback = self
            .music
            .rooms
            .get_mut(room)
            .ok_or("MUSIC_FILE_NOT_AVAILABLE")?;
        playback.advance(Instant::now());
        let asset_id = s(v, "id");
        let provider_id = playback
            .track
            .as_ref()
            .filter(|t| {
                t.stream == Some(true)
                    && t.id == asset_id
                    && t.asset_id.as_deref() == Some(asset_id)
            })
            .and_then(|t| t.provider_id.clone())
            .ok_or("MUSIC_FILE_NOT_AVAILABLE")?;
        let offset = v["offset"]
            .as_u64()
            .filter(|&n| n < MAX_STREAM_AUDIO)
            .ok_or(STREAM_OFFSET)?;
        Ok((helper.clone(), provider_id, offset))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const FIXTURE_URL: &str = "http://127.0.0.1:8765/test.wav";
    fn catalog() -> Catalog {
        Catalog::parse(
            &json!([{ "url":FIXTURE_URL, "title":"Test", "durationMs":1000 }]).to_string(),
        )
        .unwrap()
    }
    fn after(at: Instant, ms: u64) -> Instant {
        at + Duration::from_millis(ms)
    }

    #[tokio::test]
    async fn music_stream_checks_helper_contract_and_rechecks_authorization_after_io() {
        use axum::{extract::Query, http::StatusCode, routing::get, Router};
        use std::sync::atomic::{AtomicUsize, Ordering};

        let upstream_calls = Arc::new(AtomicUsize::new(0));
        let mode = Arc::new(AtomicUsize::new(0));
        let entered = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let helper =
            StreamHelper::configured(&format!("http://{}/chunk", listener.local_addr().unwrap()))
                .unwrap();
        let helper_router = {
            let (calls, mode, entered, release) = (
                upstream_calls.clone(),
                mode.clone(),
                entered.clone(),
                release.clone(),
            );
            Router::new().route("/resolve", get(|Query(query): Query<HashMap<String, String>>| async move {
                let limit = query["limit"].parse::<usize>().unwrap();
                if limit != DEFAULT_ADD_LIMIT {
                    assert_eq!(limit, MAX_QUEUE - 1);
                    assert!(query.contains_key("playlist"));
                    let title = "🎵".repeat(120);
                    let tracks: Vec<_> = (1..=limit)
                        .map(|n| json!({"id":n.to_string(),"title":title,"durationMs":60_000}))
                        .collect();
                    return axum::Json(json!({"tracks":tracks}));
                }
                if query.get("id").map(String::as_str) == Some(PROVIDER_ID) {
                    axum::Json(json!({"tracks":[{"id":PROVIDER_ID,"title":"Fixture track","durationMs":251534}]}))
                } else {
                    assert_eq!(query.get("playlist").map(String::as_str), Some("01234567-89ab-cdef-0123-456789abcdef"));
                    axum::Json(json!({"tracks":[{"id":"123","title":"Another fixture","durationMs":10000}]}))
                }
            })).route(
                "/chunk",
                get(move |Query(query): Query<HashMap<String, String>>| {
                    let (calls, mode, entered, release) = (
                        calls.clone(),
                        mode.clone(),
                        entered.clone(),
                        release.clone(),
                    );
                    async move {
                        assert_eq!(
                            query,
                            HashMap::from([
                                ("id".into(), if mode.load(Ordering::SeqCst) == 3 { "123" } else { PROVIDER_ID }.into()),
                                ("offset".into(), "0".into()),
                                ("limit".into(), CHUNK_BYTES.to_string())
                            ])
                        );
                        calls.fetch_add(1, Ordering::SeqCst);
                        let range = match mode.load(Ordering::SeqCst) {
                            1 => "bytes 1-4/5",
                            2 => {
                                entered.notify_one();
                                release.notified().await;
                                "bytes 0-3/4"
                            }
                            _ => "bytes 0-3/4",
                        };
                        (
                            StatusCode::PARTIAL_CONTENT,
                            [
                                ("content-type", "audio/mpeg"),
                                ("content-length", "4"),
                                ("content-range", range),
                            ],
                            "ID3x",
                        )
                    }
                }),
            )
        };
        let helper_task =
            tokio::spawn(async move { axum::serve(listener, helper_router).await.unwrap() });
        let root = std::env::temp_dir().join(id());
        let mut backend = Backend::open(root.join("db.json")).unwrap();
        let owner = backend.db["users"][0].clone();
        let token = backend.token(&owner, "voice", false).unwrap();
        let other = backend.token(&owner, "other", false).unwrap();
        backend.db["groups"][0]["channels"][4]["id"] = json!(APPROVED_ROOM);
        backend.music.stream = Some(helper);
        let client_id = id();
        backend
            .request(
                json!({"op":"voice_join","room":APPROVED_ROOM,"token":token,"client":client_id}),
            )
            .unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/api", listener.local_addr().unwrap());
        let api_task = tokio::spawn(async move {
            axum::serve(listener, super::super::api_router(backend))
                .await
                .unwrap()
        });
        let client = reqwest::Client::new();
        let request = |body: Value, token: &str| {
            client
                .post(&url)
                .header("cookie", format!("mines_session={token}"))
                .json(&body)
        };
        let add = |url: String| json!({"op":"music_command","room":APPROVED_ROOM,"action":"add","url":url});
        let body = add(format!("https://{APPROVED_KEY}"));
        assert_eq!(
            request(body.clone(), "").send().await.unwrap().status(),
            401
        );
        assert_eq!(
            request(body.clone(), &other).send().await.unwrap().status(),
            403
        );
        let current = request(body, &token)
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["data"]
            .clone();
        let asset = s(&current["track"], "assetId");
        assert_eq!(current["track"]["stream"], true);
        assert_eq!(current["track"]["url"], "");
        assert_eq!(current["track"]["title"], "Fixture track");
        assert!(!current.to_string().contains(PROVIDER_ID));
        let another = request(
            add("https://music.yandex.ru/playlists/01234567-89ab-cdef-0123-456789abcdef".into()),
            &token,
        )
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json::<Value>()
        .await
        .unwrap()["data"]
            .clone();
        let queued = s(&another["queue"][0], "assetId");
        assert_eq!(another["queue"][0]["title"], "Another fixture");
        let chunk = |asset: &str, offset: Value| json!({"op":"music_stream_chunk","room":APPROVED_ROOM,"id":asset,"offset":offset});
        for (body, session, status) in [
            (chunk(asset, json!(0)), "", 401),
            (chunk(asset, json!(0)), other.as_str(), 403),
            (chunk(queued, json!(0)), token.as_str(), 404),
            (chunk(asset, json!(-1)), token.as_str(), 416),
            (chunk(asset, json!("0")), token.as_str(), 416),
            (chunk(asset, json!(MAX_STREAM_AUDIO)), token.as_str(), 416),
        ] {
            assert_eq!(
                request(body, session)
                    .send()
                    .await
                    .unwrap()
                    .status()
                    .as_u16(),
                status
            );
        }
        assert_eq!(upstream_calls.load(Ordering::SeqCst), 0);
        let chunk = chunk(asset, json!(0));
        let r = request(chunk.clone(), &token).send().await.unwrap();
        assert_eq!(r.headers()["cache-control"], "no-store");
        assert_eq!(
            r.json::<Value>().await.unwrap()["data"],
            json!({"ok":true,"mime":"audio/mpeg",
            "data":"SUQzeA==","offset":0,"nextOffset":4,"totalBytes":4,"eof":true})
        );
        mode.store(1, Ordering::SeqCst);
        assert_eq!(
            request(chunk.clone(), &token)
                .send()
                .await
                .unwrap()
                .status(),
            502
        );
        mode.store(2, Ordering::SeqCst);
        let pending_read = tokio::spawn(request(chunk, &token).send());
        tokio::time::timeout(Duration::from_secs(2), entered.notified())
            .await
            .unwrap();
        let skip = request(
            json!({"op":"music_command","room":APPROVED_ROOM,"action":"skip"}),
            &token,
        );
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), skip.send())
                .await
                .unwrap()
                .unwrap()
                .status(),
            200
        );
        release.notify_one();
        assert_eq!(pending_read.await.unwrap().unwrap().status(), 404);
        mode.store(3, Ordering::SeqCst);
        assert_eq!(
            request(
                json!({"op":"music_stream_chunk","room":APPROVED_ROOM,"id":queued,"offset":0}),
                &token
            )
            .send()
            .await
            .unwrap()
            .status(),
            200
        );
        let mut large =
            add("https://music.yandex.ru/playlists/01234567-89ab-cdef-0123-456789abcdef".into());
        // One waiting track is present when resolving the explicit maximum.
        request(
            add("https://music.yandex.ru/playlists/01234567-89ab-cdef-0123-456789abcdef".into()),
            &token,
        )
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
        large["limit"] = json!(MAX_QUEUE);
        let full = request(large.clone(), &token)
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        assert_eq!(full["data"]["queue"].as_array().unwrap().len(), MAX_QUEUE);
        assert_eq!(
            full["data"]["queue"][MAX_QUEUE - 1]["title"],
            "🎵".repeat(120)
        );
        let full_error = request(large, &token).send().await.unwrap();
        assert!(full_error
            .text()
            .await
            .unwrap()
            .contains("MUSIC_QUEUE_FULL"));
        api_task.abort();
        helper_task.abort();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn music_add_limit_defaults_and_accepts_only_bounded_integers() {
        assert_eq!(music_add_limit(&json!({})).unwrap(), 32);
        for limit in [1, 32, 1000] {
            assert_eq!(music_add_limit(&json!({"limit":limit})).unwrap(), limit);
        }
        for limit in [
            json!(0),
            json!(-1),
            json!(1001),
            json!(1.5),
            json!("32"),
            json!(null),
            json!(true),
        ] {
            assert_eq!(
                music_add_limit(&json!({"limit":limit})).unwrap_err(),
                "MUSIC_INVALID_LIMIT"
            );
        }
    }

    #[test]
    fn music_yandex_link_shapes_allow_only_canonical_provider_components() {
        assert!(
            matches!(YandexInput::parse("https://music.yandex.com/track/42?utm_source=share"), Some(YandexInput::Track(id)) if id == "42")
        );
        assert!(
            matches!(YandexInput::parse("https://music.ya.ru/users/example.name/playlists/100/"), Some(YandexInput::UserPlaylist { owner, kind }) if owner == "example.name" && kind == "100")
        );
        for url in [
            "https://music.yandex.ru.evil.test/track/42",
            "https://music.yandex.ru:443/track/42",
            "https://music.yandex.ru/album/x/track/42",
            "https://music.yandex.ru/track/042",
            "https://music.yandex.ru/users/../playlists/10",
            "https://music.yandex.ru/users/x%2Fy/playlists/10",
            "https://music.yandex.ru/track/42#x",
            "https://music.yandex.ru/playlists/not-a-uuid",
        ] {
            assert!(YandexInput::parse(url).is_none(), "{url}");
        }
    }

    #[test]
    fn music_stream_configuration_only_accepts_a_literal_loopback_chunk_endpoint() {
        for url in [
            "",
            "https://127.0.0.1:18761/chunk",
            "http://localhost:18761/chunk",
            "http://127.0.0.1:18761/chunk?key=secret",
            "http://127.0.0.1:18761/other",
            "http://127.0.0.1@outside.test:18761/chunk",
        ] {
            assert!(StreamHelper::configured(url).is_err());
        }
    }

    #[test]
    fn music_clock_survives_pause_resume_and_late_poll_rollover() {
        let at = Instant::now();
        let mut p = Playback::default();
        for _ in 0..3 {
            p.command("add", Some(catalog().resolve(FIXTURE_URL).unwrap()), at)
                .unwrap();
        }
        let third = p.queue[1].id.clone();
        p.command("pause", None, after(at, 200)).unwrap();
        p.advance(after(at, 1400));
        assert_eq!(p.state("r", after(at, 1400), 5700)["status"], "paused");
        assert_eq!(p.position(after(at, 1400)), 200);
        p.command("resume", None, after(at, 1400)).unwrap();
        p.advance(after(at, 3400));
        let state = p.state("r", after(at, 3400), 7700);
        assert_eq!(state["track"]["id"], third);
        assert_eq!(state["positionMs"], 200);
        assert_eq!(state["serverTimeMs"], 7700);
        assert_eq!(state["revision"], 7);
        p.advance(after(at, 4200));
        assert_eq!(p.state("r", after(at, 4200), 8500)["status"], "idle");
    }

    #[test]
    fn music_provider_resolves_only_exact_approved_links() {
        let c = catalog();
        assert_eq!(c.resolve(FIXTURE_URL).unwrap().source.url, FIXTURE_URL);
        for url in [
            "http://localhost:8765/test.wav",
            "https://example.test/test.wav",
            "file:///tmp/test.wav",
            "https://music.yandex.ru@example.test/album/1",
        ] {
            assert_eq!(
                c.resolve(url).err().as_deref(),
                Some("MUSIC_SOURCE_NOT_APPROVED")
            );
        }
        assert_eq!(
            c.resolve("https://music.yandex.ru/album/1")
                .err()
                .as_deref(),
            Some("MUSIC_PROVIDER_NOT_CONFIGURED")
        );
        assert!(Catalog::default().resolve(FIXTURE_URL).is_err());
        for url in [
            "http://example.test/audio.wav",
            "file:///test.wav",
            "https://user:secret@example.test/audio",
            "https://music.yandex.ru/album/1",
        ] {
            assert!(Catalog::parse(
                &json!([{ "url":url, "title":"Test", "durationMs":1000 }]).to_string()
            )
            .is_err());
        }
    }

    const ALIAS: &str = "https://music.yandex.ru/album/12/track/34";

    fn alias_entry(input: &str, media: &str) -> Value {
        json!({"inputUrl": input, "url": media, "title": "Test", "durationMs": 1000})
    }

    #[test]
    fn music_alias_maps_only_the_configured_track_to_loopback_media() {
        let c = Catalog::parse(&json!([alias_entry(ALIAS, FIXTURE_URL)]).to_string()).unwrap();
        for input in [
            ALIAS,
            "HTTPS://MUSIC.YANDEX.RU/album/12/track/34/?utm_source=share",
            FIXTURE_URL,
        ] {
            let track = serde_json::to_value(c.resolve(input).unwrap()).unwrap();
            assert_eq!(track["url"], FIXTURE_URL);
            assert_eq!(track["title"], "Test");
            assert_eq!(track["durationMs"], 1000);
            assert!(track.get("inputUrl").is_none());
        }
        assert_eq!(
            c.resolve("https://music.yandex.ru/album/12/track/35")
                .err()
                .as_deref(),
            Some("MUSIC_PROVIDER_NOT_CONFIGURED")
        );
        for input in [
            "https://music.yandex.ru/album/12/track/34#x",
            "https://music.yandex.ru:443/album/12/track/34",
            "http://music.yandex.ru/album/12/track/34",
            "https://music.yandex.ru/other/../album/12/track/34",
            "https://music.yandex.ru/album/12/track/%33%34",
        ] {
            assert_eq!(
                c.resolve(input).err().as_deref(),
                Some("MUSIC_PROVIDER_NOT_CONFIGURED")
            );
            assert!(Catalog::parse(&json!([alias_entry(input, FIXTURE_URL)]).to_string()).is_err());
        }
        for input in [
            "https://music.yandex.ru.example/track/34",
            "https://music.yandex.ru@example.org/track/34",
            "https://example.org/track/34",
        ] {
            assert!(Catalog::parse(&json!([alias_entry(input, FIXTURE_URL)]).to_string()).is_err());
        }
        assert_eq!(
            Catalog::default().resolve(ALIAS).err().as_deref(),
            Some("MUSIC_PROVIDER_NOT_CONFIGURED")
        );
    }

    #[test]
    fn music_alias_rejects_nonloopback_media_and_duplicate_normalized_keys() {
        for media in [
            "https://example.org/test.wav",
            "http://192.168.0.1/test.wav",
            "http://localhost.example.org/test.wav",
            "http://user@localhost/test.wav",
        ] {
            assert!(Catalog::parse(&json!([alias_entry(ALIAS, media)]).to_string()).is_err());
        }
        for media in ["http://localhost/test.wav", "https://[::1]/test.wav"] {
            let c = Catalog::parse(
                &json!([alias_entry("https://music.yandex.ru/track/34", media)]).to_string(),
            )
            .unwrap();
            assert_eq!(
                c.resolve("https://music.yandex.ru/track/34")
                    .unwrap()
                    .source
                    .url,
                media
            );
        }
        let invalid = json!([
            alias_entry(ALIAS, FIXTURE_URL),
            alias_entry(
                "https://MUSIC.YANDEX.RU/album/12/track/34/?share=1",
                "http://localhost/other.wav"
            )
        ]);
        assert_eq!(
            Catalog::parse(&invalid.to_string()).err().as_deref(),
            Some("Invalid MINES_MUSIC_TEST_CATALOG")
        );
    }

    #[test]
    fn music_queue_is_bounded_and_skip_and_stop_replace_playback() {
        let mut p = Playback::default();
        let c = catalog();
        let at = Instant::now();
        for _ in 0..=MAX_QUEUE {
            p.command("add", Some(c.resolve(FIXTURE_URL).unwrap()), at)
                .unwrap();
        }
        assert_eq!(
            p.command("add", Some(c.resolve(FIXTURE_URL).unwrap()), at)
                .unwrap_err(),
            "MUSIC_QUEUE_FULL"
        );
        let next = p.queue[0].id.clone();
        p.command("skip", None, after(at, 100)).unwrap();
        assert_eq!(p.track.as_ref().unwrap().id, next);
        assert_eq!(p.position(after(at, 100)), 0);
        p.command("stop", None, after(at, 200)).unwrap();
        assert!(p.track.is_none() && p.queue.is_empty());
    }

    #[test]
    fn shuffle_preserves_current_track_position_and_queue_membership() {
        let mut playback = Playback::default();
        let at = Instant::now();
        let catalog = catalog();
        for _ in 0..5 {
            playback.command("add", Some(catalog.resolve(FIXTURE_URL).unwrap()), at).unwrap();
        }
        let current = playback.track.as_ref().unwrap().id.clone();
        let mut before: Vec<_> = playback.queue.iter().map(|track| track.id.clone()).collect();
        let revision = playback.revision;
        playback.command("shuffle", None, after(at, 350)).unwrap();
        let mut after_shuffle: Vec<_> = playback.queue.iter().map(|track| track.id.clone()).collect();
        before.sort();
        after_shuffle.sort();
        assert_eq!(before, after_shuffle);
        assert_eq!(playback.track.as_ref().unwrap().id, current);
        assert_eq!(playback.position(after(at, 350)), 350);
        assert_eq!(playback.revision, revision + 1);
    }

    #[test]
    fn provider_metadata_only_exposes_approved_cover_urls() {
        for (cover, expected) in [
            ("https://avatars.yandex.net/get-music-content/42/200x200", true),
            ("https://avatars.yandex.net.example.org/200x200", false),
            ("http://avatars.yandex.net/200x200", false),
        ] {
            let resolved: ResolvedTrack = serde_json::from_value(json!({
                "id":"123","title":"Track","artist":"Artist","durationMs":1000,"coverUrl":cover
            })).unwrap();
            let track = json!(resolved.into_track().unwrap());
            assert_eq!(track["artist"], "Artist");
            assert_eq!(track["coverUrl"].as_str().is_some(), expected);
        }
    }

    const PRIVATE_AUDIO: &[u8] = b"ID3\x04\x00\x00\x00\x00\x00\x00";

    fn private_fixture(data_dir: &Path, room: &str) -> std::path::PathBuf {
        let dir = data_dir.join("private-music");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("track.json"),
            json!({"roomId":room,"inputUrl":ALIAS,"title":"Private","durationMs":60_000})
                .to_string(),
        )
        .unwrap();
        fs::write(dir.join("track.mp3"), PRIVATE_AUDIO).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
            for file in ["track.json", "track.mp3"] {
                fs::set_permissions(dir.join(file), fs::Permissions::from_mode(0o600)).unwrap();
            }
        }
        dir
    }

    #[test]
    fn private_music_load_is_bounded_and_paths_are_fixed() {
        let root = std::env::temp_dir().join(id());
        let room = id();
        let dir = private_fixture(&root, &room);
        assert_eq!(PrivateTrack::load(&root).unwrap().room, room);
        fs::write(dir.join("track.json"), json!({"roomId":room,"inputUrl":ALIAS,"title":"Private","durationMs":1000,"file":"../other.mp3"}).to_string()).unwrap();
        assert_eq!(
            PrivateTrack::load(&root).err().as_deref(),
            Some(PRIVATE_CONFIG_ERROR)
        );
        private_fixture(&root, &room);
        let file = fs::OpenOptions::new()
            .write(true)
            .open(dir.join("track.mp3"))
            .unwrap();
        file.set_len(MAX_PRIVATE_AUDIO + 1).unwrap();
        drop(file);
        assert_eq!(
            PrivateTrack::load(&root).err().as_deref(),
            Some(PRIVATE_CONFIG_ERROR)
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::{symlink, PermissionsExt};
            private_fixture(&root, &room);
            fs::set_permissions(dir.join("track.mp3"), fs::Permissions::from_mode(0o644)).unwrap();
            assert!(PrivateTrack::load(&root).is_err());
            fs::rename(dir.join("track.mp3"), root.join("elsewhere.mp3")).unwrap();
            fs::set_permissions(
                root.join("elsewhere.mp3"),
                fs::Permissions::from_mode(0o600),
            )
            .unwrap();
            symlink(root.join("elsewhere.mp3"), dir.join("track.mp3")).unwrap();
            assert!(PrivateTrack::load(&root).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn private_music_only_serves_active_track_to_the_same_active_room_session() {
        let root = std::env::temp_dir().join(id());
        let mut b = Backend::open(root.join("db.json")).unwrap();
        let owner = b.db["users"][0].clone();
        let token = b.token(&owner, "voice", false).unwrap();
        let other = b.token(&owner, "other", false).unwrap();
        let channels = b.db["groups"][0]["channels"].clone();
        let first = s(&channels[4], "id");
        let second = s(&channels[5], "id");
        private_fixture(&root, first);
        b.music.private = Some(PrivateTrack::load(&root).unwrap());
        b.music.catalog = catalog();
        let file = |room: &str, token: &str, asset: &str| json!({"op":"music_file","room":room,"token":token,"id":asset});
        let command = |room: &str, token: &str, action: &str, url: &str| json!({"op":"music_command","room":room,"token":token,"action":action,"url":url});
        assert_eq!(
            b.request(file(first, "", "fake")).unwrap_err(),
            "AUTH_REQUIRED"
        );
        b.request(json!({"op":"voice_join","room":first,"token":token,"client":id()}))
            .unwrap();
        b.request(json!({"op":"voice_join","room":second,"token":other,"client":id()}))
            .unwrap();
        assert_eq!(
            b.request(command(second, &other, "add", ALIAS))
                .unwrap_err(),
            "MUSIC_PROVIDER_NOT_CONFIGURED"
        );
        let current = b.request(command(first, &token, "add", ALIAS)).unwrap();
        let track = &current["track"];
        let asset = s(track, "assetId");
        assert!(!asset.is_empty());
        assert_eq!(track["id"], asset);
        assert_eq!(track["url"], "");
        assert!(!current.to_string().contains("music.yandex"));
        assert!(!current.to_string().contains("base64"));
        let next = b.request(command(first, &token, "add", ALIAS)).unwrap();
        let queued_asset = s(&next["queue"][0], "assetId");
        assert_ne!(asset, queued_asset);
        assert_eq!(
            b.request(file(first, &token, queued_asset)).unwrap_err(),
            "MUSIC_FILE_NOT_AVAILABLE"
        );
        assert_eq!(
            b.request(file(first, &other, asset)).unwrap_err(),
            "MUSIC_VOICE_REQUIRED"
        );
        assert_eq!(
            b.request(file(second, &other, asset)).unwrap_err(),
            "MUSIC_FILE_NOT_AVAILABLE"
        );
        assert_eq!(
            b.request(file(first, &token, asset)).unwrap(),
            json!({"mime":"audio/mpeg","base64":STANDARD.encode(PRIVATE_AUDIO)})
        );
        b.request(command(first, &token, "skip", "")).unwrap();
        assert_eq!(
            b.request(file(first, &token, asset)).unwrap_err(),
            "MUSIC_FILE_NOT_AVAILABLE"
        );
        assert!(b.request(file(first, &token, queued_asset)).is_ok());
        b.voice
            .iter_mut()
            .find(|peer| peer["room"] == first)
            .unwrap()["seen"] = json!(super::super::now() - 20);
        assert_eq!(
            b.request(file(first, &token, queued_asset)).unwrap_err(),
            "MUSIC_VOICE_REQUIRED"
        );
        b.db["groups"][0]["members"] = json!([]);
        assert_eq!(
            b.request(file(first, &token, queued_asset)).unwrap_err(),
            "MUSIC_ROOM_FORBIDDEN"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn music_dispatch_requires_membership_and_active_same_session_voice_and_isolates_rooms() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        b.music.catalog =
            Catalog::parse(&json!([alias_entry(ALIAS, FIXTURE_URL)]).to_string()).unwrap();
        let owner = b.db["users"][0].clone();
        let token = b.token(&owner, "voice", false).unwrap();
        let other_session = b.token(&owner, "other", false).unwrap();
        let channels = b.db["groups"][0]["channels"].clone();
        let first = s(&channels[4], "id");
        let second = s(&channels[5], "id");
        let client = id();
        assert_eq!(
            b.request(json!({"op":"music_state","room":first}))
                .unwrap_err(),
            "AUTH_REQUIRED"
        );
        assert_eq!(
            b.request(json!({"op":"music_state","room":s(&channels[0], "id"),"token":token}))
                .unwrap_err(),
            "MUSIC_ROOM_FORBIDDEN"
        );
        assert_eq!(
            b.request(json!({"op":"music_state","room":first,"token":token}))
                .unwrap_err(),
            "MUSIC_VOICE_REQUIRED"
        );
        b.request(json!({"op":"voice_join","room":first,"token":token,"client":client}))
            .unwrap();
        b.request(json!({"op":"voice_join","room":second,"token":other_session,"client":id()}))
            .unwrap();
        assert_eq!(
            b.request(
                json!({"op":"music_command","room":first,"token":other_session,"action":"stop"})
            )
            .unwrap_err(),
            "MUSIC_VOICE_REQUIRED"
        );
        let state = b
            .request(
                json!({"op":"music_command","room":first,"token":token,"action":"add","url":ALIAS}),
            )
            .unwrap();
        assert_eq!(state["track"]["url"], FIXTURE_URL);
        assert!(state["track"].get("inputUrl").is_none());
        assert_eq!(state["status"], "playing");
        let state = b
            .request(json!({"op":"music_state","room":second,"token":other_session}))
            .unwrap();
        assert_eq!(state["status"], "idle");
        assert_eq!(state["track"], Value::Null);
        b.voice[0]["seen"] = json!(super::super::now() - 20);
        assert_eq!(
            b.request(json!({"op":"music_state","room":first,"token":token}))
                .unwrap_err(),
            "MUSIC_VOICE_REQUIRED"
        );
        b.request(json!({"op":"voice_join","room":first,"token":token,"client":client}))
            .unwrap();
        assert_eq!(
            b.request(json!({"op":"music_state","room":first,"token":token}))
                .unwrap()["status"],
            "idle"
        );
        b.db["groups"][0]["members"] = json!([]);
        assert_eq!(
            b.request(json!({"op":"music_state","room":first,"token":token}))
                .unwrap_err(),
            "MUSIC_ROOM_FORBIDDEN"
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
