//! Local, account-scoped encrypted attachment cache. No credentials or original names in paths.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Instant, SystemTime},
};
const MAX: usize = 10 * 1024 * 1024;
fn hash(bytes: &[u8]) -> String {
    ring::digest::digest(&ring::digest::SHA256, bytes)
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn key(account: &str, message: &str, meta: &Value) -> String {
    hash(&serde_json::to_vec(&(account, message, &meta["id"])).unwrap())
}
fn safe(path: &Path) -> bool {
    for ancestor in path.ancestors() {
        if let Ok(m) = fs::symlink_metadata(ancestor) {
            if m.file_type().is_symlink() {
                return false;
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if m.file_attributes() & 0x400 != 0 {
                    return false;
                }
            }
        }
    }
    true
}
fn bounded_read(path: &Path, max: usize) -> Option<Vec<u8>> {
    if !safe(path) {
        return None;
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000);
    }
    let file = options.open(path).ok()?;
    let meta = file.metadata().ok()?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return None;
        }
    }
    if !meta.is_file() || meta.len() > max as u64 {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(max as u64 + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() <= max).then_some(bytes)
}
#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let from: Vec<_> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<_> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 1 | 8) } == 0 {
        Err("Cache unavailable".into())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> Result<(), String> {
    fs::rename(from, to).map_err(|_| "Cache unavailable".into())
}
fn atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if !safe(path) {
        return Err("Cache path unavailable".into());
    }
    let parent = path.parent().ok_or("Cache unavailable")?;
    fs::create_dir_all(parent).map_err(|_| "Cache unavailable")?;
    if !safe(parent) {
        return Err("Cache path unavailable".into());
    }
    let temp = parent.join(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| "Cache unavailable")?;
        f.write_all(bytes)
            .and_then(|_| f.sync_all())
            .map_err(|_| "Cache unavailable")?;
        drop(f);
        replace_file(&temp, path)
    })();
    let _ = fs::remove_file(temp);
    result
}
pub struct Cache {
    root: PathBuf,
    pub account: Option<String>,
    pub visible: HashMap<String, Value>,
    pub accepted: Option<Instant>,
    pub revision: u64,
    pub scope_revision: u64,
    limit: u32,
}
impl Cache {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            account: None,
            visible: HashMap::new(),
            accepted: None,
            revision: 0,
            scope_revision: 0,
            limit: 1024,
        }
    }
    pub fn invalidate(&mut self) {
        self.account = None;
        self.visible.clear();
        self.accepted = None;
        self.revision += 1;
        self.scope_revision += 1;
    }
    fn dir(&self) -> Option<PathBuf> {
        Some(self.root.join(hash(self.account.as_ref()?.as_bytes())))
    }
    fn entries(&self) -> Vec<(PathBuf, u64, SystemTime)> {
        let Some(dir) = self.dir() else { return vec![] };
        if !safe(&dir) {
            return vec![];
        }
        fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                if p.extension()?.to_str()? != "bin" || !safe(&p) {
                    return None;
                }
                let m = e.metadata().ok()?;
                if !m.is_file() {
                    return None;
                }
                Some((p, m.len(), m.modified().unwrap_or(SystemTime::UNIX_EPOCH)))
            })
            .collect()
    }
    pub fn info(&self) -> Value {
        let entries = self.entries();
        json!({"enabled":self.limit>0,"limitMiB":self.limit,"bytes":entries.iter().map(|e|e.1).sum::<u64>(),"files":entries.len()})
    }
    pub fn clear(&mut self) {
        self.revision += 1;
        for (p, _, _) in self.entries() {
            let _ = fs::remove_file(p);
        }
    }
    pub fn set_limit(&mut self, limit: u32) -> Result<Value, String> {
        if ![0, 256, 512, 1024, 2048, 4096].contains(&limit) {
            return Err("Invalid cache limit".into());
        }
        let dir = self.dir().ok_or("AUTH_REQUIRED")?;
        atomic(
            &dir.join("settings.json"),
            &serde_json::to_vec(&json!({"limitMiB":limit})).unwrap(),
        )?;
        self.limit = limit;
        self.revision += 1;
        self.evict(0);
        Ok(self.info())
    }
    fn evict(&mut self, extra: u64) {
        let mut entries = self.entries();
        entries.sort_by_key(|e| e.2);
        let mut bytes = entries.iter().map(|e| e.1).sum::<u64>();
        for (p, n, _) in entries {
            if bytes + extra <= self.limit as u64 * 1024 * 1024 {
                break;
            }
            if fs::remove_file(p).is_ok() {
                bytes = bytes.saturating_sub(n)
            }
        }
    }
    pub fn accept(&mut self, data: &Value) -> bool {
        let Some(account) = data["me"]["id"].as_str().filter(|s| !s.is_empty()) else {
            self.invalidate();
            return false;
        };
        let Some(messages) = data["messages"].as_array() else {
            self.invalidate();
            return false;
        };
        let changed = self.account.as_deref() != Some(account);
        self.account = Some(account.to_owned());
        if changed {
            self.limit = 1024;
            if let Some(dir) = self.dir() {
                let settings = dir.join("settings.json");
                if safe(&settings) && fs::metadata(&settings).is_ok_and(|m| m.len() < 1024) {
                    if let Ok(bytes) = fs::read(settings) {
                        if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                            if let Some(limit) = value["limitMiB"].as_u64() {
                                if [0, 256, 512, 1024, 2048, 4096].contains(&limit) {
                                    self.limit = limit as u32;
                                }
                            }
                        }
                    }
                }
            }
        }
        let previous = std::mem::take(&mut self.visible);
        self.visible = messages
            .iter()
            .filter_map(|m| {
                let id = m["id"].as_str()?;
                let mut a = m.get("attachment")?.clone();
                a.as_object_mut()?.remove("cached");
                a["id"].as_str()?;
                Some((id.to_owned(), a))
            })
            .collect();
        self.accepted = Some(Instant::now());
        if changed
            || previous.iter().any(|(id, old)| {
                self.visible
                    .get(id)
                    .is_none_or(|new| !Self::same_attachment(old, new))
            })
        {
            self.revision += 1;
            self.scope_revision += 1;
        }
        let allowed: Vec<_> = self
            .visible
            .iter()
            .map(|(m, a)| format!("{}.bin", key(account, m, a)))
            .collect();
        for (p, _, _) in self.entries() {
            if !allowed
                .iter()
                .any(|n| p.file_name().is_some_and(|s| s == n.as_str()))
            {
                let _ = fs::remove_file(p);
            }
        }
        self.evict(0);
        true
    }
    pub fn fresh(&self) -> bool {
        self.account.is_some()
            && self
                .accepted
                .is_some_and(|t| t.elapsed().as_secs_f64() <= 5.0)
    }
    fn path(&self, message: &str) -> Option<PathBuf> {
        let meta = self.visible.get(message)?;
        Some(self.dir()?.join(format!(
            "{}.bin",
            key(self.account.as_ref()?, message, meta)
        )))
    }
    pub fn same_attachment(a: &Value, b: &Value) -> bool {
        ["id", "size", "name", "mime"]
            .iter()
            .all(|field| a[*field] == b[*field])
    }
    pub fn valid(&self, message: &str, payload: &Value) -> bool {
        let Some(meta) = self.visible.get(message) else {
            return false;
        };
        let Some(encoded) = payload["data"].as_str() else {
            return false;
        };
        if encoded.len() > MAX.div_ceil(3) * 4 {
            return false;
        }
        let Ok(bytes) = STANDARD.decode(encoded) else {
            return false;
        };
        bytes.len() <= MAX
            && meta["size"].as_u64() == Some(bytes.len() as u64)
            && payload["name"] == meta["name"]
            && payload["mime"] == meta["mime"]
    }
    pub fn read(&mut self, message: &str) -> Option<Value> {
        self.read_inner(message, true)
    }
    fn read_inner(&mut self, message: &str, touch: bool) -> Option<Value> {
        if self.limit == 0 || !self.fresh() {
            return None;
        }
        let path = self.path(message)?;
        if !safe(&path) {
            return None;
        }
        let result = (|| {
            let encrypted = bounded_read(&path, MAX * 2)?;
            let plain = crate::session_storage::crypt(&encrypted, false).ok()?;
            let record: Value = serde_json::from_slice(&plain).ok()?;
            let payload = &record["payload"];
            if record["key"] != path.file_stem()?.to_str()?
                || record["digest"] != hash(&serde_json::to_vec(payload).ok()?)
                || !self.valid(message, payload)
            {
                return None;
            }
            let mut payload = payload.clone();
            payload["cached"] = json!(true);
            Some(payload)
        })();
        if result.is_none() {
            let _ = fs::remove_file(path);
        } else if touch {
            if let Ok(f) = fs::OpenOptions::new().write(true).open(&path) {
                let _ = f.set_times(fs::FileTimes::new().set_modified(SystemTime::now()));
            }
        }
        result
    }
    pub fn write(&mut self, message: &str, payload: &Value, revision: u64) {
        if self.revision != revision
            || self.limit == 0
            || !self.fresh()
            || !self.valid(message, payload)
        {
            return;
        }
        let Some(path) = self.path(message) else {
            return;
        };
        let record = json!({"key":path.file_stem().unwrap().to_str(),"digest":hash(&serde_json::to_vec(payload).unwrap()),"payload":payload});
        let Ok(bytes) = crate::session_storage::crypt(&serde_json::to_vec(&record).unwrap(), true)
        else {
            return;
        };
        self.evict(bytes.len() as u64);
        if bytes.len() as u64 > self.limit as u64 * 1024 * 1024 {
            return;
        }
        let used = self.entries().iter().map(|e| e.1).sum::<u64>();
        if used + bytes.len() as u64 <= self.limit as u64 * 1024 * 1024 {
            let _ = atomic(&path, &bytes);
        }
    }
    pub fn decorate(&mut self, data: &mut Value) {
        if let Some(messages) = data["messages"].as_array_mut() {
            for m in messages {
                if let Some(id) = m["id"].as_str().map(str::to_owned) {
                    if m["attachment"].is_object() {
                        // A UI availability hint, never permission to read bytes. State polls
                        // must not decrypt/hash/base64-decode every attachment. The actual
                        // read still checks fresh authorization and full DPAPI integrity.
                        let cached = self.limit > 0
                            && self.fresh()
                            && self.path(&id).is_some_and(|path| {
                                safe(&path)
                                    && fs::metadata(path).is_ok_and(|meta| {
                                        meta.is_file() && meta.len() <= (MAX * 2) as u64
                                    })
                            });
                        m["attachment"]["cached"] = json!(cached);
                    }
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn cache() -> Cache {
        Cache::new(std::env::temp_dir().join(uuid::Uuid::new_v4().to_string()))
    }
    fn state(account: &str) -> Value {
        json!({"me":{"id":account},"messages":[{"id":"m","attachment":{"id":"a","name":"a.txt","mime":"application/octet-stream","size":1}}]})
    }
    #[test]
    #[cfg(windows)]
    fn attachment_cache_ttl_deleted_logout_limit_and_account_persistence() {
        let mut c = cache();
        let original = state("one");
        c.accept(&original);
        let payload = json!({"name":"a.txt","mime":"application/octet-stream","data":"eA=="});
        c.write("m", &payload, c.revision);
        let mut expired = original.clone();
        expired["messages"][0]["attachment"]["expired"] = json!(true);
        c.accept(&expired);
        assert_eq!(c.read("m").unwrap()["cached"], true);
        c.invalidate();
        assert!(c.read("m").is_none());
        c.accept(&original);
        assert!(c.read("m").is_some());
        c.accept(&state("two"));
        assert!(c.read("m").is_none());
        c.accept(&original);
        assert!(c.read("m").is_some());
        c.accepted = Some(Instant::now() - std::time::Duration::from_secs(6));
        assert!(c.read("m").is_none());
        c.accept(&original);
        let old = c.revision;
        c.set_limit(0).unwrap();
        c.write("m", &payload, old);
        assert_eq!(c.info()["files"], 0);
        assert!(!c.info()["enabled"].as_bool().unwrap());
        c.invalidate();
        c.accept(&original);
        assert_eq!(c.info()["limitMiB"], 0);
        c.set_limit(256).unwrap();
        c.write("m", &payload, c.revision);
        c.accept(&json!({"me":{"id":"one"},"messages":[]}));
        assert_eq!(c.info()["files"], 0);
        assert!(c.set_limit(1).is_err());
        let _ = fs::remove_dir_all(c.root);
    }
    #[test]
    fn attachment_cache_lru_quota_and_safe_paths() {
        let mut c = cache();
        c.accept(&state("../one\\private"));
        let dir = c.dir().unwrap();
        assert_eq!(dir.parent(), Some(c.root.as_path()));
        fs::create_dir_all(&dir).unwrap();
        let old = dir.join("old.bin");
        let new = dir.join("new.bin");
        fs::write(&old, b"old").unwrap();
        fs::write(&new, b"newest").unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(&old)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(SystemTime::UNIX_EPOCH))
            .unwrap();
        c.limit = 1;
        c.evict(1024 * 1024 - 6);
        assert!(!old.exists());
        assert!(new.exists());
        assert_eq!(c.info()["bytes"], 6);
        c.evict(1024 * 1024 + 1);
        assert_eq!(c.info()["files"], 0);
        let obstruction = dir.join("blocked");
        fs::write(&obstruction, b"not a directory").unwrap();
        assert!(atomic(&obstruction.join("a"), b"x").is_err());
        let _ = fs::remove_dir_all(c.root);
    }
    #[test]
    #[cfg(windows)]
    fn attachment_cache_reparse_refused() {
        let c = cache();
        fs::create_dir_all(&c.root).unwrap();
        let target = c.root.join("target");
        fs::create_dir(&target).unwrap();
        let junction = c.root.join("junction");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&target)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
        assert!(!safe(&junction));
        assert!(bounded_read(&junction.join("private"), 100).is_none());
        assert!(atomic(&junction.join("private"), b"secret").is_err());
        assert!(!target.join("private").exists());
        fs::remove_dir(junction).unwrap();
        fs::remove_dir_all(c.root).unwrap();
    }
    #[test]
    fn attachment_cache_snapshot_write_epoch() {
        let mut cache = cache();
        let mut snapshot = state("one");
        cache.accept(&snapshot);
        let epoch = cache.revision;
        cache.accept(&snapshot);
        assert_eq!(cache.revision, epoch);
        snapshot["messages"].as_array_mut().unwrap().push(json!({"id":"new","attachment":{"id":"new","name":"b","size":0,"mime":"application/octet-stream"}}));
        cache.accept(&snapshot);
        assert_eq!(cache.revision, epoch);
        snapshot["messages"][0]["attachment"]["name"] = json!("changed");
        cache.accept(&snapshot);
        assert!(cache.revision > epoch);
    }
    #[test]
    fn attachment_cache_scope_and_freshness() {
        let mut c = cache();
        assert!(!c.fresh());
        c.accept(&state("one"));
        let a = c.path("m").unwrap();
        assert!(c.fresh());
        c.accept(&state("two"));
        assert_ne!(a, c.path("m").unwrap());
        c.accepted = Some(Instant::now() - std::time::Duration::from_secs(6));
        assert!(!c.fresh());
        c.invalidate();
        assert!(c.path("m").is_none());
    }
    #[test]
    fn attachment_cache_metadata_and_key() {
        let mut c = cache();
        c.accept(&state("one"));
        assert!(c.valid(
            "m",
            &json!({"name":"a.txt","mime":"application/octet-stream","data":"eA=="})
        ));
        assert!(!c.valid(
            "m",
            &json!({"name":"evil","mime":"application/octet-stream","data":"eA=="})
        ));
        assert_ne!(
            key("a", "bc", &json!({"id":"d"})),
            key("ab", "c", &json!({"id":"d"}))
        );
    }
    #[test]
    #[cfg(windows)]
    #[ignore = "explicit 10 MiB native cache timing probe; uses only temporary files"]
    fn attachment_cache_ten_mib_timing_probe() {
        let mut c = cache();
        let mut snapshot = state("timing-only");
        snapshot["messages"][0]["attachment"]["size"] = json!(MAX);
        c.accept(&snapshot);
        let payload = json!({"name":"a.txt","mime":"application/octet-stream","data":STANDARD.encode(vec![b'x'; MAX])});
        let message = snapshot["messages"][0].clone();
        snapshot["messages"] = json!((0..10)
            .map(|i| {
                let mut message = message.clone();
                message["id"] = json!(format!("m{i}"));
                message
            })
            .collect::<Vec<_>>());
        for i in 0..10 {
            c.accept(&snapshot);
            c.write(&format!("m{i}"), &payload, c.revision);
        }
        let start = Instant::now();
        for i in 0..10 {
            // Keep the real authorization policy; this probes the former poll work,
            // not network freshness or a relaxation of its five-second bound.
            c.accept(&snapshot);
            assert!(c.read_inner(&format!("m{i}"), false).is_some());
        }
        let former_poll = start.elapsed();
        c.accept(&snapshot);
        let start = Instant::now();
        c.decorate(&mut snapshot);
        let decorate = start.elapsed();
        assert!(snapshot["messages"]
            .as_array()
            .unwrap()
            .iter()
            .all(|m| m["attachment"]["cached"] == true));
        eprintln!("10 x 10 MiB DPAPI cache: former poll work={former_poll:?}, metadata decoration={decorate:?}");
        fs::remove_dir_all(c.root).unwrap();
    }
    #[test]
    #[cfg(windows)]
    fn attachment_cache_decoration_is_hint_read_still_verifies_integrity() {
        let mut c = cache();
        let mut snapshot = state("one");
        c.accept(&snapshot);
        let payload = json!({"name":"a.txt","mime":"application/octet-stream","data":"eA=="});
        c.write("m", &payload, c.revision);
        c.decorate(&mut snapshot);
        assert_eq!(snapshot["messages"][0]["attachment"]["cached"], true);
        fs::write(c.path("m").unwrap(), b"corrupt").unwrap();
        // Existence is deliberately optimistic, but it cannot publish any bytes.
        c.decorate(&mut snapshot);
        assert_eq!(snapshot["messages"][0]["attachment"]["cached"], true);
        assert!(c.read("m").is_none());
        c.decorate(&mut snapshot);
        assert_eq!(snapshot["messages"][0]["attachment"]["cached"], false);
        c.write("m", &payload, c.revision);
        c.accepted = Some(Instant::now() - std::time::Duration::from_secs(6));
        c.decorate(&mut snapshot);
        assert_eq!(snapshot["messages"][0]["attachment"]["cached"], false);
        c.invalidate();
        c.decorate(&mut snapshot);
        assert_eq!(snapshot["messages"][0]["attachment"]["cached"], false);
        fs::remove_dir_all(c.root).unwrap();
    }
    #[test]
    #[cfg(windows)]
    fn attachment_cache_dpapi_corruption_clear_late_write() {
        let mut c = cache();
        c.accept(&state("one"));
        let p = json!({"name":"a.txt","mime":"application/octet-stream","data":"eA=="});
        c.write("m", &p, c.revision);
        assert!(c.read("m").is_some());
        let old = c.revision;
        c.clear();
        c.write("m", &p, old);
        assert!(c.read("m").is_none());
        c.write("m", &p, c.revision);
        let path = c.path("m").unwrap();
        let encrypted = fs::read(&path).unwrap();
        let plain = crate::session_storage::crypt(&encrypted, false).unwrap();
        let mut record: Value = serde_json::from_slice(&plain).unwrap();
        record["digest"] = json!("invalid");
        fs::write(
            &path,
            crate::session_storage::crypt(&serde_json::to_vec(&record).unwrap(), true).unwrap(),
        )
        .unwrap();
        assert!(c.read("m").is_none());
        c.write("m", &p, c.revision);
        fs::write(c.path("m").unwrap(), b"corrupt").unwrap();
        assert!(c.read("m").is_none());
        assert_eq!(c.info()["files"], 0);
        let root = c.root.clone();
        let _ = fs::remove_dir_all(root);
    }
}
