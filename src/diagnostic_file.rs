//! Best-effort local persistence for the existing sanitized diagnostic event type only.
use crate::backend::diagnostics::Event;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::mpsc::{self, RecvTimeoutError},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const CURRENT: &str = "diagnostics.jsonl";
const PREVIOUS: &str = "diagnostics.previous.jsonl";
const SCRATCH: &str = ".diagnostics.cleanup.tmp";
const LOCK: &str = ".diagnostics.lock";
const MAX_BYTES: u64 = 64 * 1024;
const RETENTION: u64 = 48 * 60 * 60;
const CLEANUP_INTERVAL: Duration = Duration::from_secs(15 * 60);

pub(crate) struct Sink {
    directory: PathBuf,
    _worker_lifetime: mpsc::Sender<()>,
}

impl Sink {
    pub(crate) fn start(directory: PathBuf) -> Self {
        Self::start_with_interval(directory, CLEANUP_INTERVAL)
    }

    fn start_with_interval(directory: PathBuf, interval: Duration) -> Self {
        let _ = cleanup(&directory, now());
        let (lifetime, receiver) = mpsc::channel();
        let worker_dir = directory.clone();
        let _ = std::thread::Builder::new()
            .name("diagnostic-cleanup".into())
            .spawn(move || {
                while receiver.recv_timeout(interval) == Err(RecvTimeoutError::Timeout) {
                    let _ = cleanup(&worker_dir, now());
                }
            });
        Self {
            directory,
            _worker_lifetime: lifetime,
        }
    }

    pub(crate) fn record(&self, event: &Event) {
        let _ = self.append(event);
    }

    fn append(&self, event: &Event) -> io::Result<()> {
        let mut line = serde_json::to_vec(event)?;
        line.push(b'\n');
        if line.len() as u64 > MAX_BYTES {
            return Err(io::Error::other("Diagnostic record too large"));
        }
        let _lock = lock_directory(&self.directory)?;
        let path = self.directory.join(CURRENT);
        if let Some(info) = regular_metadata(&path)? {
            if info.len() > MAX_BYTES {
                fs::remove_file(&path)?;
            } else if info.len() + line.len() as u64 > MAX_BYTES {
                let previous = self.directory.join(PREVIOUS);
                regular_metadata(&previous)?;
                fs::rename(&path, previous)?;
            }
        }
        private_options()
            .append(true)
            .create(true)
            .open(path)?
            .write_all(&line)
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn private_options() -> OpenOptions {
    let options = OpenOptions::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = options;
        options.mode(0o600);
        options
    }
    #[cfg(not(unix))]
    options
}

fn regular_metadata(path: &Path) -> io::Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => Ok(Some(meta)),
        Ok(_) => Err(io::Error::other("Expected a regular diagnostic file")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn lock_directory(directory: &Path) -> io::Result<File> {
    fs::create_dir_all(directory)?;
    let path = directory.join(LOCK);
    regular_metadata(&path)?;
    // A separate, stable file keeps rotation and cleanup serialized across app instances.
    let lock = private_options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    lock.lock()?;
    Ok(lock)
}

#[cfg(any(feature = "desktop", test))]
fn open_read_only(path: &Path) -> io::Result<Option<File>> {
    if regular_metadata(path)?.is_none() {
        return Ok(None);
    }
    let file = File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::other("Expected a regular diagnostic file"));
    }
    Ok(Some(file))
}

#[cfg(any(feature = "desktop", test))]
fn read_recent(directory: &Path, time: u64) -> io::Result<Vec<Event>> {
    // Lock only when the writer has already created its lock file. Reading an
    // empty or missing journal must not create a directory or any files.
    let lock = open_read_only(&directory.join(LOCK))?;
    if let Some(lock) = &lock {
        lock.lock_shared()?;
    }
    let mut events = Vec::new();
    for name in [PREVIOUS, CURRENT] {
        let Some(file) = open_read_only(&directory.join(name))? else {
            continue;
        };
        if file.metadata()?.len() > MAX_BYTES {
            return Err(io::Error::other("Diagnostic file too large"));
        }
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(io::Error::other("Diagnostic file too large"));
        }
        events.extend(
            bytes
                .split_inclusive(|&byte| byte == b'\n')
                .filter(|line| line.ends_with(b"\n"))
                .filter_map(Event::from_local_line)
                .filter(|event| {
                    time.checked_sub(event.timestamp())
                        .is_some_and(|age| age < RETENTION)
                }),
        );
    }
    drop(lock);
    // Stable sort preserves previous-before-current and file order on ties.
    events.sort_by_key(Event::timestamp);
    Ok(events)
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub(crate) async fn read_local_diagnostics(
    window: tauri::WebviewWindow,
) -> Result<Vec<Event>, &'static str> {
    use tauri::Manager;
    const UNAVAILABLE: &str = "LOCAL_DIAGNOSTICS_UNAVAILABLE";
    if window.label() != "main" {
        return Err(UNAVAILABLE);
    }
    let directory = window.path().app_data_dir().map_err(|_| UNAVAILABLE)?;
    tauri::async_runtime::spawn_blocking(move || read_recent(&directory, now()))
        .await
        .map_err(|_| UNAVAILABLE)?
        .map_err(|_| UNAVAILABLE)
}

fn cleanup(directory: &Path, time: u64) -> io::Result<()> {
    let _lock = lock_directory(directory)?;
    let scratch = directory.join(SCRATCH);
    // A process may have exited between creating the scratch file and renaming it.
    if regular_metadata(&scratch)?.is_some() {
        fs::remove_file(&scratch)?;
    }
    let current = prune(&directory.join(CURRENT), &scratch, time);
    let previous = prune(&directory.join(PREVIOUS), &scratch, time);
    current.and(previous)
}

fn prune(path: &Path, scratch: &Path, time: u64) -> io::Result<()> {
    if regular_metadata(path)?.is_none() {
        return Ok(());
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_BYTES {
        return fs::remove_file(path);
    }
    let mut kept = Vec::new();
    for line in bytes.split_inclusive(|&byte| byte == b'\n') {
        // Retention is per record: a hot log's mtime never renews older entries.
        if line.ends_with(b"\n")
            && serde_json::from_slice::<serde_json::Value>(line)
                .ok()
                .and_then(|value| value["time"].as_u64())
                .is_some_and(|timestamp| time.saturating_sub(timestamp) < RETENTION)
        {
            kept.extend_from_slice(line);
        }
    }
    if kept.is_empty() {
        return fs::remove_file(path);
    }
    if kept.len() != bytes.len() {
        let result = (|| {
            let mut file = private_options()
                .write(true)
                .create_new(true)
                .open(scratch)?;
            file.write_all(&kept)?;
            drop(file);
            fs::rename(scratch, path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(scratch);
        }
        result?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_and_idle_cleanup_expire_records_without_touching_other_data() {
        let directory =
            std::env::temp_dir().join(format!("sombra-diagnostics-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let old = format!("{{\"time\":{}}}\n", now() - RETENTION);
        let recent = format!("{{\"time\":{}}}\n", now());
        fs::write(directory.join(CURRENT), format!("{old}{recent}")).unwrap();
        fs::write(directory.join(PREVIOUS), &old).unwrap();
        fs::write(directory.join("mines-db.json"), &old).unwrap();
        let sink = Sink::start_with_interval(directory.clone(), Duration::from_millis(20));
        assert_eq!(fs::read_to_string(directory.join(CURRENT)).unwrap(), recent);
        assert!(!directory.join(PREVIOUS).exists());
        {
            let _lock = lock_directory(&directory).unwrap();
            fs::write(directory.join(PREVIOUS), &old).unwrap();
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while directory.join(PREVIOUS).exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!directory.join(PREVIOUS).exists());
        assert_eq!(
            fs::read_to_string(directory.join("mines-db.json")).unwrap(),
            old
        );
        drop(sink);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reader_uses_both_files_and_returns_only_valid_recent_projected_events() {
        let directory =
            std::env::temp_dir().join(format!("sombra-diagnostics-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let time = RETENTION * 2;
        let row = |timestamp, operation: &str, category: &str, status| {
            serde_json::json!({
                "time": timestamp, "source": "desktop", "operation": operation,
                "category": category, "status": status,
                "message": "private message", "token": "private token"
            })
        };
        let null = serde_json::Value::Null;
        let boundary = row(time - RETENTION, "voice_poll", "transport", null.clone());
        let first = row(
            time - RETENTION + 1,
            "voice_poll",
            "transport",
            null.clone(),
        );
        let previous_tie = row(time - 1, "unknown", "timeout", null.clone());
        let current_tie = row(time - 1, "webview", "js_error", null.clone());
        let latest = row(time, "me", "http_error", serde_json::json!(503));
        let future = row(time + 1, "voice_poll", "transport", null.clone());
        let unknown_op = row(time, "private-op", "transport", null.clone());
        let unknown_category = row(time, "me", "private-category", null.clone());
        let wrong_runtime_pair = row(time, "me", "js_error", null.clone());
        let diagnostic_op = row(time, "diagnostics_recent", "transport", null.clone());
        let invalid_status = row(time, "me", "http_error", serde_json::json!(600));
        let mut foreign_source = latest.clone();
        foreign_source["source"] = serde_json::json!("server");
        let mut missing_status = latest.clone();
        missing_status.as_object_mut().unwrap().remove("status");
        let duplicate_field = format!("{{\"status\":null,{}", &latest.to_string()[1..]);
        let previous = format!("{previous_tie}\n{boundary}\n{first}\n{foreign_source}\n");
        let mut current = format!(
            "{latest}\n{current_tie}\n{future}\n{unknown_op}\n{unknown_category}\n{wrong_runtime_pair}\n{diagnostic_op}\n{invalid_status}\n{missing_status}\n{duplicate_field}\n[{},\"desktop\",\"me\",\"transport\",null]\n", time,
        ).into_bytes();
        current.extend_from_slice(b"\xff malformed\n");
        current.extend_from_slice(latest.to_string().as_bytes()); // no final newline
        fs::write(directory.join(PREVIOUS), &previous).unwrap();
        fs::write(directory.join(CURRENT), &current).unwrap();
        {
            let _lock = lock_directory(&directory).unwrap();
        }
        fs::write(directory.join(SCRATCH), format!("{latest}\n")).unwrap();

        let rows = read_recent(&directory, time).unwrap();
        let expected = [first, previous_tie, current_tie, latest].map(|mut event| {
            let object = event.as_object_mut().unwrap();
            object.remove("message");
            object.remove("token");
            event
        });
        assert_eq!(
            serde_json::to_value(rows).unwrap(),
            serde_json::json!(expected)
        );
        assert_eq!(
            fs::read_to_string(directory.join(PREVIOUS)).unwrap(),
            previous
        );
        assert_eq!(fs::read(directory.join(CURRENT)).unwrap(), current);
        assert!(directory.join(SCRATCH).exists());
        assert_eq!(fs::metadata(directory.join(LOCK)).unwrap().len(), 0);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reader_does_not_create_files_and_rejects_oversized_or_nonregular_files() {
        let directory =
            std::env::temp_dir().join(format!("sombra-diagnostics-{}", uuid::Uuid::new_v4()));
        assert!(read_recent(&directory, now()).unwrap().is_empty());
        assert!(!directory.exists());
        fs::create_dir_all(&directory).unwrap();
        assert!(read_recent(&directory, now()).unwrap().is_empty());
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
        let path = directory.join(PREVIOUS);
        fs::write(&path, vec![b'\n'; MAX_BYTES as usize]).unwrap();
        assert!(read_recent(&directory, now()).unwrap().is_empty());
        fs::write(&path, vec![b'\n'; MAX_BYTES as usize + 1]).unwrap();
        assert!(read_recent(&directory, now()).is_err());
        assert_eq!(fs::metadata(&path).unwrap().len(), MAX_BYTES + 1);
        fs::create_dir(directory.join(CURRENT)).unwrap();
        fs::write(&path, b"").unwrap();
        assert!(read_recent(&directory, now()).is_err());
        assert!(directory.join(CURRENT).is_dir());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rotation_replaces_previous_without_exceeding_limits() {
        let directory =
            std::env::temp_dir().join(format!("sombra-diagnostics-{}", uuid::Uuid::new_v4()));
        let sink = Sink::start(directory.clone());
        let event = Event::desktop("voice_poll", "transport", None);
        sink.append(&event).unwrap();
        let line = fs::read(directory.join(CURRENT)).unwrap();
        let full = line.repeat(MAX_BYTES as usize / line.len());
        for _ in 0..2 {
            fs::write(directory.join(CURRENT), &full).unwrap();
            sink.append(&event).unwrap();
            assert_eq!(fs::read(directory.join(CURRENT)).unwrap(), line);
            assert_eq!(fs::read(directory.join(PREVIOUS)).unwrap(), full);
        }
        drop(sink);
        fs::remove_dir_all(directory).unwrap();
    }
}
