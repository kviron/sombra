//! Private cover assets. GIF payloads are validated but never transformed.
use super::*;
use base64::engine::general_purpose::STANDARD;
use image::{AnimationDecoder, ImageDecoder, ImageFormat};
use std::{
    io::{Cursor, Read, Write},
    path::Path,
};
const MAX: usize = 2 * 1024 * 1024;
const INVALID: &str = "Некорректная обложка";
const STORAGE: &str = "STORAGE_UNAVAILABLE";

pub(super) fn public_metadata(value: &Value) -> Option<Value> {
    if !value.is_object() {
        return None;
    }
    let mut out = json!({});
    for key in ["id", "mime", "width", "height", "crop", "animated", "bytes"] {
        out[key] = value[key].clone();
    }
    Some(out)
}
fn limits() -> image::Limits {
    let mut l = image::Limits::default();
    l.max_image_width = Some(2048);
    l.max_image_height = Some(2048);
    l.max_alloc = Some(64 * 1024 * 1024);
    l
}
fn crop(value: &Value, w: u32, h: u32) -> Result<Value, String> {
    let mut n = [0.; 4];
    for (i, k) in ["x", "y", "width", "height"].iter().enumerate() {
        n[i] = value[*k]
            .as_f64()
            .filter(|v| v.is_finite())
            .ok_or(INVALID)?;
    }
    let [x, y, cw, ch] = n;
    if x < 0.
        || y < 0.
        || cw <= 0.
        || ch <= 0.
        || x + cw > 100.00000001
        || y + ch > 100.00000001
        || ((cw * w as f64) / (ch * h as f64) / 3. - 1.).abs() > 0.005
    {
        return Err(INVALID.into());
    }
    Ok(json!({"x":x,"y":y,"width":cw,"height":ch}))
}
// Walk container bytes before any codec/LZW work. image's GIF decoder permits
// descriptors outside the logical screen; without this check a tiny screen could
// hide huge decoded frames and bypass the logical-canvas work budget.
fn gif_preflight(bytes: &[u8]) -> Result<u64, String> {
    fn take<'a>(bytes: &'a [u8], offset: &mut usize, length: usize) -> Result<&'a [u8], String> {
        let end = offset.checked_add(length).ok_or(INVALID)?;
        let part = bytes.get(*offset..end).ok_or(INVALID)?;
        *offset = end;
        Ok(part)
    }
    fn table(bytes: &[u8], offset: &mut usize, packed: u8) -> Result<(), String> {
        if packed & 0x80 != 0 {
            take(bytes, offset, 3 * (1usize << ((packed & 7) + 1)))?;
        }
        Ok(())
    }
    fn blocks(bytes: &[u8], offset: &mut usize) -> Result<(), String> {
        loop {
            let length = take(bytes, offset, 1)?[0] as usize;
            if length == 0 {
                return Ok(());
            }
            take(bytes, offset, length)?;
        }
    }
    fn word(bytes: &[u8], offset: usize) -> u32 {
        u16::from_le_bytes([bytes[offset], bytes[offset + 1]]) as u32
    }
    let mut offset = 0;
    let header = take(bytes, &mut offset, 13)?;
    if !matches!(&header[..6], b"GIF87a" | b"GIF89a") {
        return Err(INVALID.into());
    }
    let (width, height) = (word(header, 6), word(header, 8));
    if width == 0 || height == 0 || width > 2048 || height > 2048 {
        return Err(INVALID.into());
    }
    table(bytes, &mut offset, header[10])?;
    let mut count = 0u64;
    loop {
        match take(bytes, &mut offset, 1)?[0] {
            0x21 => {
                // Extension label followed by size-prefixed sub-blocks.
                take(bytes, &mut offset, 1)?;
                blocks(bytes, &mut offset)?;
            }
            0x2c => {
                let frame = take(bytes, &mut offset, 9)?;
                let (x, y, w, h) = (
                    word(frame, 0),
                    word(frame, 2),
                    word(frame, 4),
                    word(frame, 6),
                );
                count += 1;
                if w == 0
                    || h == 0
                    || x + w > width
                    || y + h > height
                    || count > 240
                    || width as u64 * height as u64 * count > 60_000_000
                {
                    return Err(INVALID.into());
                }
                table(bytes, &mut offset, frame[8])?;
                let code_size = take(bytes, &mut offset, 1)?[0];
                if !(2..=8).contains(&code_size) {
                    return Err(INVALID.into());
                }
                blocks(bytes, &mut offset)?;
            }
            0x3b if count > 0 && offset == bytes.len() => return Ok(count),
            _ => return Err(INVALID.into()),
        }
    }
}
fn validate(value: &Value) -> Result<(Value, Vec<u8>), String> {
    let uri = value["dataUrl"].as_str().ok_or(INVALID)?;
    let (prefix, encoded) = uri.split_once(',').ok_or(INVALID)?;
    let (mime, format) = match prefix {
        "data:image/png;base64" => ("image/png", ImageFormat::Png),
        "data:image/jpeg;base64" => ("image/jpeg", ImageFormat::Jpeg),
        "data:image/webp;base64" => ("image/webp", ImageFormat::WebP),
        "data:image/gif;base64" => ("image/gif", ImageFormat::Gif),
        _ => return Err(INVALID.into()),
    };
    if encoded.len() > MAX.div_ceil(3) * 4 {
        return Err(INVALID.into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| INVALID)?;
    if bytes.is_empty() || bytes.len() > MAX || image::guess_format(&bytes).ok() != Some(format) {
        return Err(INVALID.into());
    }
    let gif_frames = if format == ImageFormat::Gif {
        Some(gif_preflight(&bytes)?)
    } else {
        None
    };
    let mut reader = image::ImageReader::with_format(Cursor::new(&bytes), format);
    reader.limits(limits());
    let mut decoder = reader.into_decoder().map_err(|_| INVALID)?;
    decoder.set_limits(limits()).map_err(|_| INVALID)?;
    let (w, h) = decoder.dimensions();
    if w == 0 || h == 0 || w > 2048 || h > 2048 {
        return Err(INVALID.into());
    }
    let normalized = crop(&value["crop"], w, h)?;
    let animated = if format == ImageFormat::Gif {
        drop(decoder);
        let mut gif =
            image::codecs::gif::GifDecoder::new(Cursor::new(&bytes)).map_err(|_| INVALID)?;
        gif.set_limits(limits()).map_err(|_| INVALID)?;
        let mut count = 0u64;
        for frame in gif.into_frames() {
            count += 1;
            if count > 240 || w as u64 * h as u64 * count > 60_000_000 {
                return Err(INVALID.into());
            }
            frame.map_err(|_| INVALID)?;
        }
        if Some(count) != gif_frames {
            return Err(INVALID.into());
        }
        count > 1
    } else {
        if w as u64 * h as u64 > 4_000_000 {
            return Err(INVALID.into());
        }
        // Animated WebP/PNG are not accepted as a disguised unbounded animation.
        if format == ImageFormat::WebP
            && image::codecs::webp::WebPDecoder::new(Cursor::new(&bytes))
                .map_err(|_| INVALID)?
                .has_animation()
        {
            return Err(INVALID.into());
        }
        if format == ImageFormat::Png
            && image::codecs::png::PngDecoder::new(Cursor::new(&bytes))
                .map_err(|_| INVALID)?
                .is_apng()
                .map_err(|_| INVALID)?
        {
            return Err(INVALID.into());
        }
        image::DynamicImage::from_decoder(decoder).map_err(|_| INVALID)?;
        false
    };
    let sha = B64.encode(digest::digest(&digest::SHA256, &bytes).as_ref());
    Ok((
        json!({"id":id(),"mime":mime,"width":w,"height":h,"crop":normalized,"animated":animated,"bytes":bytes.len(),"sha256":sha}),
        bytes,
    ))
}
fn ordinary(path: &Path, dir: bool) -> Result<(), String> {
    let m = std::fs::symlink_metadata(path).map_err(|_| STORAGE)?;
    if m.file_type().is_symlink() || if dir { !m.is_dir() } else { !m.is_file() } {
        return Err(STORAGE.into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err(STORAGE.into());
        }
    }
    Ok(())
}
impl Backend {
    // Rename is the commit point. A post-commit directory-sync failure must not
    // trigger removal of the asset now referenced by the committed database.
    fn commit_cover(&self) -> Result<(), String> {
        ordinary(self.path.parent().ok_or(STORAGE)?, true)?;
        ordinary(&self.path, false)?;
        let temporary = self.path.with_extension("tmp");
        match std::fs::symlink_metadata(&temporary) {
            Ok(_) => ordinary(&temporary, false)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(STORAGE.into()),
        }
        let mut file = std::fs::File::create(&temporary).map_err(|_| STORAGE)?;
        file.write_all(&serde_json::to_vec_pretty(&self.db).map_err(|_| STORAGE)?)
            .and_then(|_| file.sync_all())
            .map_err(|_| STORAGE)?;
        std::fs::rename(&temporary, &self.path).map_err(|_| STORAGE)?;
        #[cfg(unix)]
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::File::open(parent).and_then(|d| d.sync_all());
        }
        Ok(())
    }
    fn cover_path(&self, metadata: &Value) -> Result<PathBuf, String> {
        let raw = metadata["id"].as_str().ok_or(STORAGE)?;
        if uuid::Uuid::parse_str(raw).map_err(|_| STORAGE)?.to_string() != raw {
            return Err(STORAGE.into());
        }
        let parent = self.path.parent().ok_or(STORAGE)?;
        ordinary(parent, true)?;
        let dir = parent.join("profile-covers");
        ordinary(&dir, true)?;
        Ok(dir.join(raw))
    }
    pub(super) fn set_profile_cover(&mut self, v: &Value) -> Result<Value, String> {
        let user = self.authenticate(s(v, "token"))?;
        let index = self.db["users"]
            .as_array()
            .unwrap()
            .iter()
            .position(|u| u["id"] == user["id"])
            .ok_or("AUTH_REQUIRED")?;
        let value = v.get("cover").ok_or(INVALID)?;
        let mut created = None;
        let metadata = if value.is_null() {
            Value::Null
        } else {
            let (meta, bytes) = validate(value)?;
            let parent = self.path.parent().ok_or(STORAGE)?;
            ordinary(parent, true)?;
            let dir = parent.join("profile-covers");
            if !dir.exists() {
                std::fs::create_dir(&dir).map_err(|_| STORAGE)?;
            }
            ordinary(&dir, true)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
                    .map_err(|_| STORAGE)?;
            }
            let path = self.cover_path(&meta)?;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&path).map_err(|_| STORAGE)?;
            if file
                .write_all(&bytes)
                .and_then(|_| file.sync_all())
                .is_err()
            {
                drop(file);
                let _ = std::fs::remove_file(&path);
                return Err(STORAGE.into());
            }
            #[cfg(unix)]
            if std::fs::File::open(&dir)
                .and_then(|d| d.sync_all())
                .is_err()
            {
                drop(file);
                let _ = std::fs::remove_file(&path);
                return Err(STORAGE.into());
            }
            created = Some(path);
            meta
        };
        let previous = self.db["users"][index].clone();
        let old_path = self.cover_path(&previous["profile_cover"]).ok();
        self.db["users"][index]["profile_cover"] = metadata;
        if let Err(e) = self.commit_cover() {
            self.db["users"][index] = previous;
            if let Some(path) = created {
                let _ = std::fs::remove_file(path);
            }
            return Err(e);
        }
        if let Some(path) = old_path {
            if ordinary(&path, false).is_ok() {
                let _ = std::fs::remove_file(path);
            }
        }
        Ok(json!({"user":self.public(&self.db["users"][index])}))
    }
    pub(super) fn profile_cover(&self, v: &Value) -> Result<Value, String> {
        self.authenticate(s(v, "token"))?;
        let user = self.db["users"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| {
                u["id"] == v["user"]
                    && u["active"] != false
                    && (u["bot"] != true
                        || self.db["bots"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|b| b["id"] == u["id"] && b["enabled"] != false))
            })
            .ok_or(INVALID)?;
        let meta = &user["profile_cover"];
        if !v["coverId"].is_string() || meta["id"] != v["coverId"] {
            return Err(INVALID.into());
        }
        let path = self.cover_path(meta)?;
        ordinary(&path, false)?;
        let file = std::fs::File::open(path).map_err(|_| STORAGE)?;
        let mut bytes = Vec::new();
        file.take((MAX + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| STORAGE)?;
        if bytes.len() > MAX
            || meta["bytes"].as_u64() != Some(bytes.len() as u64)
            || meta["sha256"] != B64.encode(digest::digest(&digest::SHA256, &bytes).as_ref())
        {
            return Err(STORAGE.into());
        }
        let mut result = public_metadata(meta).ok_or(INVALID)?;
        result["user"] = user["id"].clone();
        result["data"] = json!(STANDARD.encode(bytes));
        Ok(result)
    }
}
#[cfg(test)]
mod tests;
