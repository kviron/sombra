//! Bounded GIF decoding and private blob storage for uploaded catalog entries.
use super::*;
use base64::engine::general_purpose::STANDARD;
use image::{AnimationDecoder, ImageDecoder};
use std::io::{Cursor, Read, Write};

const MAX_SIZE: usize = 2 * 1024 * 1024;
const STORAGE: &str = "STORAGE_UNAVAILABLE";

pub(super) fn validated_gif(
    id: &str,
    target: &str,
    data: &Value,
) -> Result<(Value, Vec<u8>), String> {
    let data = data
        .as_str()
        .filter(|data| data.len() <= MAX_SIZE.div_ceil(3) * 4)
        .ok_or(INVALID)?;
    let bytes = STANDARD.decode(data).map_err(|_| INVALID)?;
    if bytes.len() > MAX_SIZE {
        return Err(INVALID.into());
    }
    let frames = profile_covers::gif_preflight(&bytes).map_err(|_| INVALID)?;
    let max = if target == "avatar" { 512 } else { 1280 };
    // Preflight verifies that all frame rectangles are contained by this canvas and
    // the trailer is the end of the file. Limit work before decoding pixel data.
    let width = u16::from_le_bytes([bytes[6], bytes[7]]) as u32;
    let height = u16::from_le_bytes([bytes[8], bytes[9]]) as u32;
    if width > max
        || height > max
        || !(2..=120).contains(&frames)
        || u64::from(width) * u64::from(height) * frames > 30_000_000
    {
        return Err(INVALID.into());
    }
    let mut gif = image::codecs::gif::GifDecoder::new(Cursor::new(&bytes)).map_err(|_| INVALID)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(max);
    limits.max_image_height = Some(max);
    limits.max_alloc = Some(32 * 1024 * 1024);
    gif.set_limits(limits).map_err(|_| INVALID)?;
    let mut decoded = 0;
    for frame in gif.into_frames() {
        frame.map_err(|_| INVALID)?;
        decoded += 1;
    }
    if decoded != frames {
        return Err(INVALID.into());
    }
    let asset = json!({"id":id,"mime":"image/gif","width":width,"height":height,"frames":frames,"size":bytes.len()});
    Ok((asset, bytes))
}

pub(super) fn checksum(bytes: &[u8]) -> String {
    B64.encode(digest::digest(&digest::SHA256, bytes).as_ref())
}

impl Backend {
    fn profile_effect_dir(&self) -> Result<PathBuf, String> {
        let parent = self.path.parent().ok_or(STORAGE)?;
        profile_covers::ordinary(parent, true)?;
        Ok(parent.join("profile-effect-assets"))
    }

    pub(super) fn write_profile_effect_blob(
        &self,
        id: &str,
        bytes: &[u8],
    ) -> Result<PathBuf, String> {
        let dir = self.profile_effect_dir()?;
        let builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        let builder = {
            use std::os::unix::fs::DirBuilderExt;
            let mut builder = builder;
            builder.mode(0o700);
            builder
        };
        if let Err(err) = builder.create(&dir) {
            if err.kind() != std::io::ErrorKind::AlreadyExists {
                return Err(STORAGE.into());
            }
        }
        profile_covers::ordinary(&dir, true)?;
        #[cfg(unix)]
        std::fs::File::open(dir.parent().ok_or(STORAGE)?)
            .and_then(|parent| parent.sync_all())
            .map_err(|_| STORAGE)?;
        let path = dir.join(id);
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path).map_err(|_| STORAGE)?;
        let written = file.write_all(bytes).and_then(|_| file.sync_all());
        drop(file);
        #[cfg(unix)]
        let written = written.and_then(|_| std::fs::File::open(&dir)?.sync_all());
        if written.is_err() {
            let _ = std::fs::remove_file(&path);
            return Err(STORAGE.into());
        }
        Ok(path)
    }

    pub(super) fn read_profile_effect_blob(
        &self,
        id: &str,
        asset: &Value,
    ) -> Result<Value, String> {
        let dir = self.profile_effect_dir()?;
        profile_covers::ordinary(&dir, true)?;
        let path = dir.join(id);
        profile_covers::ordinary(&path, false)?;
        let file = std::fs::File::open(path).map_err(|_| STORAGE)?;
        let mut bytes = Vec::new();
        file.take((MAX_SIZE + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| STORAGE)?;
        if bytes.len() > MAX_SIZE
            || asset["size"].as_u64() != Some(bytes.len() as u64)
            || self.db[BLOB_HASHES][id] != checksum(&bytes)
        {
            return Err(STORAGE.into());
        }
        Ok(json!({"asset":asset,"data":STANDARD.encode(bytes)}))
    }
}
