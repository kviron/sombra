use super::{s, Backend};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{
    codecs::{png::PngDecoder, webp::WebPEncoder},
    AnimationDecoder, DynamicImage, ExtendedColorType, ImageFormat, ImageReader,
};
use serde_json::{json, Value};
use std::{
    fs::File,
    io::{Cursor, Read},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::{sync::Semaphore, task::JoinError};

const MAX_ENCODED: usize = 350_000;
const MAX_SOURCE_SIDE: u32 = 2048;
const THUMBNAIL_SIDE: u32 = 128;
const UNAVAILABLE: &str = "STICKER_THUMBNAIL_UNAVAILABLE";

pub(super) struct StickerThumbnailQueue {
    slots: Arc<Semaphore>,
    workers: Arc<Semaphore>,
}

impl Default for StickerThumbnailQueue {
    fn default() -> Self {
        Self {
            slots: Arc::new(Semaphore::new(16)),
            workers: Arc::new(Semaphore::new(2)),
        }
    }
}

impl StickerThumbnailQueue {
    pub(super) async fn request(
        &self,
        backend: Arc<Mutex<Backend>>,
        request: Value,
    ) -> Result<Result<Value, String>, JoinError> {
        let Ok(slot) = self.slots.clone().try_acquire_owned() else {
            return Ok(Err("STICKER_THUMBNAIL_BUSY".into()));
        };
        let Ok(worker) = self.workers.clone().acquire_owned().await else {
            return Ok(Err("STORAGE_UNAVAILABLE".into()));
        };
        tokio::task::spawn_blocking(move || {
            let _permits = (slot, worker);
            let source = backend
                .lock()
                .map_err(|_| "STORAGE_UNAVAILABLE")?
                .prepare_sticker_thumbnail(&request)?;
            let thumbnail = source.render()?;
            // An access change during decoding must not release the preview.
            backend
                .lock()
                .map_err(|_| "STORAGE_UNAVAILABLE")?
                .authorized_sticker(&request)?;
            Ok(thumbnail)
        })
        .await
    }
}

pub(super) enum StickerThumbnailSource {
    Inline(String),
    File(PathBuf),
}

impl Backend {
    pub(super) fn authorized_sticker(&self, request: &Value) -> Result<&Value, String> {
        let user = self.authenticate(s(request, "token"))?;
        let uid = s(&user, "id");
        self.db["stickers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|sticker| {
                sticker["id"] == request["sticker"]
                    && (self.sticker_in_library(sticker, uid)
                        || self.sticker_in_history(sticker, uid)
                        || self.sticker_pack_is_public(sticker))
            })
            .ok_or_else(|| "Стикер не найден".into())
    }

    pub(super) fn prepare_sticker_thumbnail(
        &self,
        request: &Value,
    ) -> Result<StickerThumbnailSource, String> {
        let sticker = self.authorized_sticker(request)?;
        if let Some(image) = sticker["image"].as_str() {
            if image.len() > MAX_ENCODED + 32 {
                return Err(UNAVAILABLE.into());
            }
            return Ok(StickerThumbnailSource::Inline(image.to_owned()));
        }
        Ok(StickerThumbnailSource::File(
            self.sticker_asset_path(s(sticker, "asset")),
        ))
    }
}

impl StickerThumbnailSource {
    pub(super) fn render(self) -> Result<Value, String> {
        let data = match self {
            Self::Inline(data) => data,
            Self::File(path) => {
                let mut data = String::new();
                File::open(path)
                    .map_err(|_| UNAVAILABLE)?
                    .take((MAX_ENCODED + 33) as u64)
                    .read_to_string(&mut data)
                    .map_err(|_| UNAVAILABLE)?;
                data
            }
        };
        Ok(json!({"image": encode_thumbnail(&data)?}))
    }
}

fn encode_thumbnail(data: &str) -> Result<String, String> {
    let (prefix, encoded) = data.split_once(',').ok_or(UNAVAILABLE)?;
    let format = match prefix {
        "data:image/png;base64" => ImageFormat::Png,
        "data:image/webp;base64" => ImageFormat::WebP,
        _ => return Err(UNAVAILABLE.into()),
    };
    if encoded.len() > MAX_ENCODED {
        return Err(UNAVAILABLE.into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| UNAVAILABLE)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_SIDE);
    limits.max_image_height = Some(MAX_SOURCE_SIDE);
    limits.max_alloc = Some(32 * 1024 * 1024);
    let image = if format == ImageFormat::Png {
        let decoder =
            PngDecoder::with_limits(Cursor::new(bytes), limits).map_err(|_| UNAVAILABLE)?;
        if decoder.is_apng().map_err(|_| UNAVAILABLE)? {
            let frame = decoder
                .apng()
                .map_err(|_| UNAVAILABLE)?
                .into_frames()
                .next()
                .ok_or(UNAVAILABLE)?
                .map_err(|_| UNAVAILABLE)?;
            DynamicImage::ImageRgba8(frame.into_buffer())
        } else {
            DynamicImage::from_decoder(decoder).map_err(|_| UNAVAILABLE)?
        }
    } else {
        // The WebP decoder's static read returns the first frame for animated WebP.
        let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
        reader.limits(limits);
        reader.decode().map_err(|_| UNAVAILABLE)?
    };
    let image = if image.width().max(image.height()) > THUMBNAIL_SIDE {
        image.thumbnail(THUMBNAIL_SIDE, THUMBNAIL_SIDE)
    } else {
        image
    }
    .into_rgba8();
    let mut output = Vec::new();
    WebPEncoder::new_lossless(&mut output)
        .encode(
            image.as_raw(),
            image.width(),
            image.height(),
            ExtendedColorType::Rgba8,
        )
        .map_err(|_| UNAVAILABLE)?;
    Ok(format!(
        "data:image/webp;base64,{}",
        STANDARD.encode(output)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{codecs::png::PngEncoder, GenericImageView, ImageEncoder, Rgba, RgbaImage};

    fn png(width: u32, height: u32) -> String {
        let image = RgbaImage::from_pixel(width, height, Rgba([30, 40, 50, 110]));
        let mut bytes = Vec::new();
        PngEncoder::new(&mut bytes)
            .write_image(image.as_raw(), width, height, ExtendedColorType::Rgba8)
            .unwrap();
        format!("data:image/png;base64,{}", STANDARD.encode(bytes))
    }

    #[test]
    fn thumbnail_scales_to_128_and_preserves_alpha() {
        let image = encode_thumbnail(&png(384, 192)).unwrap();
        let bytes = STANDARD
            .decode(image.strip_prefix("data:image/webp;base64,").unwrap())
            .unwrap();
        let preview = image::load_from_memory(&bytes).unwrap();
        assert_eq!(preview.dimensions(), (128, 64));
        assert_eq!(preview.get_pixel(0, 0)[3], 110);
    }

    #[test]
    fn thumbnail_rejects_invalid_or_oversized_images() {
        assert!(encode_thumbnail("data:image/png;base64,iVBORw0KGgo=").is_err());
        assert!(encode_thumbnail(&png(MAX_SOURCE_SIDE + 1, 1)).is_err());
    }

    #[test]
    fn animated_thumbnails_use_the_first_frame() {
        // Two tiny frames. The first is red, the second blue.
        let apng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAABAAAAAQBPJcTWAAAACGFjVEwAAAACAAAAAYSKo+YAAAAaZmNUTAAAAAAAAAACAAAAAgAAAAAAAAAAAAEAAQAA5AEz4QAAABVJREFUeJxj/MvA8J+BgYGBBUSAMAAfBwICi13EvwAAABpmY1RMAAAAAQAAAAIAAAACAAAAAAAAAAAAAQABAAB/ctk1AAAAGWZkQVQAAAACeJxjZGD495+BgYGBBUSAMAAdHAIDHR9TuQAAAABJRU5ErkJggg==";
        let webp = "data:image/webp;base64,UklGRoQAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAD/////AQBBTk1GKAAAAAAAAAAAAAEAAAEAAOgDAAJWUDhMDwAAAC8BQAAABxDtj/4HIqL/AQBBTk1GKAAAAAAAAAAAAAEAAAEAAOgDAABWUDhMDwAAAC8BQAAABxBR//4HIqL/AQA=";
        for original in [apng, webp] {
            let preview = encode_thumbnail(original).unwrap();
            let bytes = STANDARD.decode(preview.split_once(',').unwrap().1).unwrap();
            let pixel = image::load_from_memory(&bytes).unwrap().get_pixel(0, 0);
            assert!(pixel[0] > 200 && pixel[2] < 30);
        }
    }
}
