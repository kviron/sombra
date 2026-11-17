use super::*;
fn encoded(format: ImageFormat, w: u32, h: u32) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(w, h)
        .write_to(&mut out, format)
        .unwrap();
    out.into_inner()
}
fn payload(bytes: &[u8], mime: &str) -> Value {
    json!({"dataUrl":format!("data:{mime};base64,{}",STANDARD.encode(bytes)),"crop":{"x":0,"y":0,"width":100,"height":100}})
}
fn fixture() -> (Backend, String) {
    let path = std::env::temp_dir().join(id()).join("db.json");
    let mut b = Backend::open(path).unwrap();
    let u = b.db["users"][0].clone();
    let t = b.token(&u, "test", false).unwrap();
    (b, t)
}
#[test]
fn codec_crop_and_strict_uri_validation() {
    for (format, mime) in [
        (ImageFormat::Png, "image/png"),
        (ImageFormat::Jpeg, "image/jpeg"),
        (ImageFormat::WebP, "image/webp"),
    ] {
        let bytes = encoded(format, 12, 4);
        let (meta, out) = validate(&payload(&bytes, mime)).unwrap();
        assert_eq!(out, bytes);
        assert_eq!(meta["width"], 12);
        assert_eq!(meta["animated"], false);
    }
    let bytes = encoded(ImageFormat::Png, 12, 4);
    let good = payload(&bytes, "image/png");
    for uri in [
        "https://example.com/a.png",
        "data:image/svg+xml;base64,AAAA",
        "data:image/png;BASE64,AAAA",
        "data:image/png;base64,!!!!",
        "data:image/jpeg;base64,/9j/",
        "data:image/png;base64,iVBORw0KGgo=",
    ] {
        let mut v = good.clone();
        v["dataUrl"] = json!(uri);
        assert!(validate(&v).is_err(), "{uri}");
    }
    assert!(validate(&payload(&bytes, "image/jpeg")).is_err());
    for c in [
        json!({"x":-1,"y":0,"width":100,"height":100}),
        json!({"x":1,"y":0,"width":100,"height":100}),
        json!({"x":0,"y":0,"width":0,"height":100}),
        json!({"x":0,"y":0,"width":50,"height":100}),
        json!({"x":null,"y":0,"width":100,"height":100}),
        json!({"x":"NaN","y":0,"width":100,"height":100}),
    ] {
        let mut v = good.clone();
        v["crop"] = c;
        assert!(validate(&v).is_err());
    }
    assert!(validate(&payload(&encoded(ImageFormat::Png, 2049, 683), "image/png")).is_err());
    assert!(validate(&payload(&vec![0; MAX + 1], "image/png")).is_err());
    let oversized = encoded(ImageFormat::Png, 2048, 2048);
    let mut v = payload(&oversized, "image/png");
    v["crop"]["height"] = json!(100. / 3.);
    assert!(validate(&v).is_err());
}
fn gif(frames: usize, w: u32, h: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut enc = image::codecs::gif::GifEncoder::new(&mut bytes);
        enc.set_repeat(image::codecs::gif::Repeat::Infinite)
            .unwrap();
        for i in 0..frames {
            let buffer = image::RgbaImage::from_pixel(w, h, image::Rgba([i as u8, 0, 0, 255]));
            enc.encode_frame(image::Frame::from_parts(
                buffer,
                0,
                0,
                image::Delay::from_numer_denom_ms(30 + i as u32 * 10, 1),
            ))
            .unwrap();
        }
    }
    bytes
}
#[test]
fn gif_original_delays_loop_and_bounded_frames() {
    let bytes = gif(3, 12, 12);
    let mut v = payload(&bytes, "image/gif");
    v["crop"]["height"] = json!(100.0 / 3.0);
    let (meta, out) = validate(&v).unwrap();
    assert_eq!(out, bytes);
    assert_eq!(meta["animated"], true);
    let frames = image::codecs::gif::GifDecoder::new(Cursor::new(out))
        .unwrap()
        .into_frames()
        .collect_frames()
        .unwrap();
    assert_eq!(frames.len(), 3);
    assert_eq!(frames[1].delay().numer_denom_ms(), (40, 1));
    assert!(bytes.windows(11).any(|w| w == b"NETSCAPE2.0"));
    assert!(validate(&payload(&gif(241, 3, 1), "image/gif")).is_err());
    let bytes = gif(61, 1000, 1000);
    let mut v = payload(&bytes, "image/gif");
    v["crop"]["height"] = json!(100. / 3.);
    assert!(validate(&v).is_err());
}
#[test]
fn gif_descriptor_preflight_rejects_hidden_large_frames_before_decode() {
    let mut forged = gif(1, 64, 64);
    // Leave the real 64×64 image descriptor/LZW stream untouched, but lie about
    // a 3×1 logical screen. image 0.25's decoder alone accepts this mismatch.
    forged[6..10].copy_from_slice(&[3, 0, 1, 0]);
    assert!(gif_preflight(&forged).is_err());
    assert!(validate(&payload(&forged, "image/gif")).is_err());
    // Even the header-only prefix fails, proving preflight does not rely on
    // decompressing (or successfully decoding) image data to detect bounds.
    for end in [0, 6, 12, forged.len() - 1] {
        assert!(gif_preflight(&forged[..end]).is_err());
    }
    let valid = gif(2, 12, 4);
    assert_eq!(gif_preflight(&valid).unwrap(), 2);
    let mut trailing = valid.clone();
    trailing.push(0);
    assert!(gif_preflight(&trailing).is_err());
    // Frame count is checked by the container walk before any LZW work.
    assert!(gif_preflight(&gif(241, 3, 1)).is_err());
}
#[test]
fn private_metadata_auth_replace_clear_persistence_and_rollback() {
    let (mut b, t) = fixture();
    let path = b.path.clone();
    let uid = b.db["users"][0]["id"].clone();
    assert_eq!(b.public(&b.db["users"][0])["coverSupported"], true);
    assert!(b.public(&b.db["users"][0]).get("cover").is_none());
    let p = payload(&encoded(ImageFormat::Png, 12, 4), "image/png");
    let set = json!({"op":"set_profile_cover","token":t,"cover":p,"user":"other"});
    let mut unauth = set.clone();
    unauth["token"] = json!("");
    assert_eq!(b.request(unauth).unwrap_err(), "AUTH_REQUIRED");
    let bot = json!({"id":id(),"bot":true});
    b.db["users"].as_array_mut().unwrap().push(bot.clone());
    let bt = b.token(&bot, "bot", false).unwrap();
    let mut denied = set.clone();
    denied["token"] = json!(bt);
    assert_eq!(b.request(denied).unwrap_err(), "AUTH_REQUIRED");
    let guest = json!({"id":id(),"name":"Guest"});
    b.db["users"].as_array_mut().unwrap().push(guest.clone());
    let gt = b.token(&guest, "guest", false).unwrap();
    let result = b.request(set.clone()).unwrap();
    let cover = result["user"]["cover"].clone();
    assert_eq!(cover.as_object().unwrap().len(), 7);
    assert!(cover.get("data").is_none());
    assert!(cover.get("sha256").is_none());
    assert!(b.db["users"][2]["profile_cover"].is_null());
    let read = json!({"op":"profile_cover","token":gt,"user":uid,"coverId":cover["id"]});
    let fetched = b.request(read.clone()).unwrap();
    assert_eq!(
        fetched["data"],
        p["dataUrl"].as_str().unwrap().split_once(',').unwrap().1
    );
    let state = b.request(json!({"op":"state","token":t})).unwrap();
    assert!(!state.to_string().contains("data:image/png"));
    assert!(!state.to_string().contains("sha256"));
    let mut reopened = Backend::open(path.clone()).unwrap();
    assert_eq!(reopened.request(read.clone()).unwrap(), fetched);
    let old = b.cover_path(&b.db["users"][0]["profile_cover"]).unwrap();
    std::fs::create_dir(path.with_extension("tmp")).unwrap();
    assert!(b.request(set.clone()).is_err());
    assert!(old.exists());
    assert_eq!(b.request(read.clone()).unwrap(), fetched);
    assert_eq!(std::fs::read_dir(old.parent().unwrap()).unwrap().count(), 1);
    std::fs::remove_dir(path.with_extension("tmp")).unwrap();
    let gif_bytes = gif(3, 12, 12);
    let mut animated = payload(&gif_bytes, "image/gif");
    animated["crop"]["height"] = json!(100. / 3.);
    let mut gifset = set;
    gifset["cover"] = animated;
    let updated = b.request(gifset).unwrap();
    assert!(!old.exists());
    assert!(b.request(read).is_err());
    let loaded=b.request(json!({"op":"profile_cover","token":t,"user":uid,"coverId":updated["user"]["cover"]["id"]})).unwrap();
    assert_eq!(
        STANDARD.decode(loaded["data"].as_str().unwrap()).unwrap(),
        gif_bytes
    );
    assert_eq!(loaded["animated"], true);
    b.request(json!({"op":"set_profile_cover","token":t,"cover":null}))
        .unwrap();
    assert!(b.public(&b.db["users"][0]).get("cover").is_none());
    assert_eq!(std::fs::read_dir(old.parent().unwrap()).unwrap().count(), 0);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[tokio::test]
async fn http_cookie_auth_no_store_and_safe_diagnostics() {
    let (b, t) = fixture();
    let path = b.path.clone();
    let uid = b.db["users"][0]["id"].clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, api_router(b)).await.unwrap() });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    for op in ["set_profile_cover", "profile_cover"] {
        let response = client
            .post(&url)
            .json(&json!({"op":op,"token":t,"cover":null}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 401);
        assert_eq!(diagnostics::operation(op), op);
    }
    let p = payload(&encoded(ImageFormat::Png, 12, 4), "image/png");
    let cookie = format!("mines_session={t}");
    let response = client
        .post(&url)
        .header("cookie", &cookie)
        .json(&json!({"op":"set_profile_cover","cover":p}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let response: Value = response.json().await.unwrap();
    let cover = &response["data"]["user"]["cover"];
    let response = client
        .post(&url)
        .header("cookie", &cookie)
        .json(&json!({"op":"profile_cover","user":uid,"coverId":cover["id"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let response = client
        .post(&url)
        .header("cookie", &cookie)
        .json(&json!({"op":"diagnostics_recent"}))
        .send()
        .await
        .unwrap();
    let d: Value = response.json().await.unwrap();
    let d = d.to_string();
    assert!(!d.contains("data:image"));
    assert!(!d.contains(cover["id"].as_str().unwrap()));
    server.abort();
    let _ = server.await;
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[cfg(unix)]
#[test]
fn symlink_asset_and_directory_are_refused() {
    use std::os::unix::fs::symlink;
    let (mut b, t) = fixture();
    let root = b.path.parent().unwrap().to_path_buf();
    let target = root.join("target");
    std::fs::create_dir(&target).unwrap();
    let directory = root.join("profile-covers");
    symlink(&target, &directory).unwrap();
    let p = payload(&encoded(ImageFormat::Png, 12, 4), "image/png");
    assert!(b
        .request(json!({"op":"set_profile_cover","token":t,"cover":p}))
        .is_err());
    std::fs::remove_file(&directory).unwrap();
    let result = b
        .request(json!({"op":"set_profile_cover","token":t,"cover":p}))
        .unwrap();
    let metadata = b.db["users"][0]["profile_cover"].clone();
    let asset = b.cover_path(&metadata).unwrap();
    let original = std::fs::read(&asset).unwrap();
    std::fs::remove_file(&asset).unwrap();
    let target = root.join("external");
    std::fs::write(&target, original).unwrap();
    symlink(&target, &asset).unwrap();
    assert!(b.request(json!({"op":"profile_cover","token":t,"user":result["user"]["id"],"coverId":metadata["id"]})).is_err());
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn file_integrity_and_disabled_unknown_targets() {
    let (mut b, t) = fixture();
    let uid = b.db["users"][0]["id"].clone();
    let path = b.path.clone();
    let p = payload(&encoded(ImageFormat::Png, 12, 4), "image/png");
    b.request(json!({"op":"set_profile_cover","token":t,"cover":p}))
        .unwrap();
    let meta = b.db["users"][0]["profile_cover"].clone();
    let file = b.cover_path(&meta).unwrap();
    let read = json!({"op":"profile_cover","token":t,"user":uid,"coverId":meta["id"]});
    let mut unknown = read.clone();
    unknown["user"] = json!("unknown");
    assert!(b.request(unknown).is_err());
    let bot = json!({"id":id(),"bot":true,"profile_cover":meta});
    b.db["users"].as_array_mut().unwrap().push(bot.clone());
    let mut botread = read.clone();
    botread["user"] = bot["id"].clone();
    assert!(b.request(botread).is_err());
    std::fs::write(&file, vec![0; meta["bytes"].as_u64().unwrap() as usize]).unwrap();
    assert_eq!(b.request(read).unwrap_err(), STORAGE);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
