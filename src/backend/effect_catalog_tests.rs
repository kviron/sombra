use super::*;
use base64::engine::general_purpose::STANDARD;

fn gif(frames: usize) -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
        encoder
            .set_repeat(image::codecs::gif::Repeat::Infinite)
            .unwrap();
        for n in 0..frames {
            let mut pixels = image::RgbaImage::new(4, 3);
            pixels.put_pixel((n % 4) as u32, 0, image::Rgba([255, 0, 0, 255]));
            encoder
                .encode_frame(image::Frame::from_parts(
                    pixels,
                    0,
                    0,
                    image::Delay::from_numer_denom_ms(80, 1),
                ))
                .unwrap();
        }
    }
    bytes
}

#[test]
fn uploaded_catalog_round_trip_and_revocable_equipped_access() {
    let (mut b, path, owner, wearer, stranger) = fixture();
    let data = STANDARD.encode(gif(2));
    let item = b.request(json!({"op":"upload_profile_effect","token":owner,"title":" Fire GIF ","target":"avatar","data":data})).unwrap()["item"].clone();
    let id = &item["id"];
    let asset = &item["asset"];
    assert_eq!(item["title"], "Fire GIF");
    assert!(item["decoration"].is_null());
    assert_eq!(
        *asset,
        json!({"id":id,"mime":"image/gif","width":4,"height":3,"frames":2,"size":gif(2).len()})
    );
    let req = |op: &str, token: &str| json!({"op":op,"token":token,"id":id});
    let list = |token: &str, scope: &str| json!({"op":"list_profile_effects","token":token,"scope":scope,"target":"avatar"});
    assert_eq!(
        b.request(list(&owner, "personal")).unwrap()["items"],
        json!([item])
    );
    assert_eq!(
        b.request(list(&stranger, "catalog")).unwrap()["items"],
        json!([])
    );
    assert_eq!(
        b.request(req("profile_effect_file", "bad")).unwrap_err(),
        "AUTH_REQUIRED"
    );
    assert_eq!(
        b.request(req("profile_effect_file", &stranger))
            .unwrap_err(),
        NOT_FOUND
    );
    b.request(req("publish_profile_effect", &owner)).unwrap();
    assert_eq!(
        b.request(list(&stranger, "catalog")).unwrap()["items"][0]["asset"],
        *asset
    );
    assert_eq!(
        b.request(req("profile_effect_file", &stranger)).unwrap(),
        json!({"asset":asset,"data":data})
    );
    let applied = b.request(req("apply_profile_effect", &wearer)).unwrap();
    assert_eq!(applied["user"]["profileEffectAssets"]["avatar"], *asset);
    assert!(applied["user"].get("decorations").is_none());
    b.request(req("unpublish_profile_effect", &owner)).unwrap();
    drop(b);
    let mut b = Backend::open(path.clone()).unwrap();
    let state = b.request(json!({"op":"state","token":stranger})).unwrap();
    assert_eq!(state["profileEffectUploadsSupported"], true);
    assert_eq!(state["users"][1]["profileEffectAssets"]["avatar"], *asset);
    assert_eq!(
        b.request(req("apply_profile_effect", &stranger))
            .unwrap_err(),
        NOT_FOUND
    );
    assert_eq!(
        b.request(req("profile_effect_file", &stranger)).unwrap()["data"],
        data
    );
    let cleared = b.request(json!({"op":"set_profile_decoration","token":wearer,"target":"avatar","decoration":null})).unwrap();
    assert!(cleared["user"].get("profileEffectAssets").is_none());
    assert_eq!(
        b.request(req("profile_effect_file", &stranger))
            .unwrap_err(),
        NOT_FOUND
    );
    assert_eq!(
        b.request(req("profile_effect_file", &wearer)).unwrap()["data"],
        data
    );
    let blob = path
        .parent()
        .unwrap()
        .join("profile-effect-assets")
        .join(id.as_str().unwrap());
    let mut tampered = gif(2);
    tampered[0] ^= 1;
    std::fs::write(blob, tampered).unwrap();
    assert_eq!(
        b.request(req("profile_effect_file", &owner)).unwrap_err(),
        "STORAGE_UNAVAILABLE"
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn rejects_invalid_gifs_and_rolls_back_blob_on_commit_failure() {
    let (mut b, path, owner, _, _) = fixture();
    let request = |data: String| json!({"op":"upload_profile_effect","token":owner,"title":"Cover GIF","target":"cover","data":data});
    let valid = gif(2);
    let mut extra = valid.clone();
    extra.push(0);
    let mut outside = valid.clone();
    outside[6..8].copy_from_slice(&1u16.to_le_bytes());
    let mut too_wide = valid.clone();
    too_wide[6..8].copy_from_slice(&1281u16.to_le_bytes());
    let mut over_budget = gif(60);
    over_budget[6..8].copy_from_slice(&1024u16.to_le_bytes());
    over_budget[8..10].copy_from_slice(&1024u16.to_le_bytes());
    for invalid in [
        gif(1),
        gif(121),
        extra,
        outside,
        too_wide,
        over_budget,
        valid[..valid.len() - 1].to_vec(),
        b"<svg/>".to_vec(),
    ] {
        assert_eq!(
            b.request(request(STANDARD.encode(invalid))).unwrap_err(),
            INVALID
        );
    }
    assert_eq!(
        b.request(request(format!(
            "data:image/gif;base64,{}",
            STANDARD.encode(&valid)
        )))
        .unwrap_err(),
        INVALID
    );
    let before = b.db.clone();
    std::fs::create_dir(path.with_extension("tmp")).unwrap();
    assert_eq!(
        b.request(request(STANDARD.encode(&valid))).unwrap_err(),
        "STORAGE_UNAVAILABLE"
    );
    assert_eq!(b.db, before);
    assert_eq!(
        std::fs::read_dir(path.parent().unwrap().join("profile-effect-assets"))
            .unwrap()
            .count(),
        0
    );
    std::fs::remove_dir(path.with_extension("tmp")).unwrap();
    for _ in 0..MAX_UPLOADS_PER_OWNER {
        b.request(request(STANDARD.encode(&valid))).unwrap();
    }
    assert_eq!(
        b.request(request(STANDARD.encode(&valid))).unwrap_err(),
        LIMIT
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn http_blob_uses_human_cookie_and_no_store() {
    let (b, path, owner, _, stranger) = fixture();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, api_router(b)).await.unwrap() });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let data = STANDARD.encode(gif(2));
    let upload = json!({"op":"upload_profile_effect","token":owner,"target":"cover","title":"Animated","data":data});
    let response = client
        .post(&url)
        .bearer_auth(&owner)
        .json(&upload)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
    let owner_cookie = format!("mines_session={owner}");
    let response = client
        .post(&url)
        .header("cookie", &owner_cookie)
        .json(&upload)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let result: Value = response.json().await.unwrap();
    let asset = &result["data"]["item"]["asset"];
    let read = json!({"op":"profile_effect_file","id":asset["id"],"token":owner});
    let response = client.post(&url).json(&read).send().await.unwrap();
    assert_eq!(response.status(), 401);
    let response = client
        .post(&url)
        .header("cookie", format!("mines_session={stranger}"))
        .json(&read)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 404);
    let response = client
        .post(&url)
        .header("cookie", &owner_cookie)
        .json(&read)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let result: Value = response.json().await.unwrap();
    assert_eq!(result["data"], json!({"asset":asset,"data":data}));
    server.abort();
    let _ = server.await;
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

fn fixture() -> (Backend, PathBuf, String, String, String) {
    let path = std::env::temp_dir().join(id()).join("db.json");
    let mut b = Backend::open(path.clone()).unwrap();
    let owner = b.db["users"][0].clone();
    let owner = b.token(&owner, "catalog", false).unwrap();
    let mut guests = Vec::new();
    for name in ["wearer", "stranger"] {
        let guest = json!({"id":id(),"name":name});
        b.db["users"].as_array_mut().unwrap().push(guest.clone());
        guests.push(b.token(&guest, name, false).unwrap());
    }
    b.request(json!({"op":"me","token":owner})).unwrap();
    (b, path, owner, guests.remove(0), guests.remove(0))
}

fn doc() -> Value {
    json!({"v":1,"target":"avatar","seed":19,"layers":[{"effect":"holy/divine-shield","palette":"ember","anchor":"ring","intensity":0.9}]})
}

#[test]
fn private_to_public_to_retained_with_viewer_safe_projection() {
    let (mut b, path, owner, wearer, stranger) = fixture();
    let item = b.request(json!({"op":"create_profile_effect","token":owner,"title":"  Ember  ","target":"avatar","decoration":doc()})).unwrap()["item"].clone();
    let id = &item["id"];
    assert_eq!(item["title"], "Ember");
    assert_eq!(item["public"], false);
    let listing = |token: &str, scope: &str| json!({"op":"list_profile_effects","token":token,"scope":scope,"target":"avatar","limit":1});
    let req = |op: &str, token: &str| json!({"op":op,"token":token,"id":id});
    assert_eq!(
        b.request(listing(&owner, "personal")).unwrap()["items"][0],
        item
    );
    assert_eq!(
        b.request(listing(&wearer, "catalog")).unwrap()["items"],
        json!([])
    );
    assert_eq!(
        b.request(req("apply_profile_effect", &wearer)).unwrap_err(),
        NOT_FOUND
    );
    assert_eq!(
        b.request(req("apply_profile_effect", &owner)).unwrap()["user"]["decorationRefs"]["avatar"],
        *id
    );
    let owned_view = b.request(json!({"op":"state","token":owner})).unwrap();
    assert_eq!(owned_view["me"]["decorationRefs"]["avatar"], *id);
    assert_eq!(owned_view["users"][0]["decorationRefs"]["avatar"], *id);
    let guest_view = b.request(json!({"op":"state","token":wearer})).unwrap();
    assert_eq!(guest_view["users"][0]["decorations"]["avatar"], doc());
    assert!(guest_view["users"][0].get("decorationRefs").is_none());
    b.request(req("publish_profile_effect", &owner)).unwrap();
    assert_eq!(
        b.request(listing(&wearer, "catalog")).unwrap()["items"][0]["id"],
        *id
    );
    assert_eq!(b.public(&b.db["users"][0])["decorationRefs"]["avatar"], *id);
    assert_eq!(
        b.request(req("unpublish_profile_effect", &wearer))
            .unwrap_err(),
        "PROFILE_EFFECT_FORBIDDEN"
    );
    let applied = b.request(req("apply_profile_effect", &wearer)).unwrap();
    assert_eq!(applied["user"]["decorations"]["avatar"], doc());
    b.request(req("unpublish_profile_effect", &owner)).unwrap();
    drop(b);
    let mut b = Backend::open(path.clone()).unwrap();
    assert!(b.public(&b.db["users"][1]).get("decorationRefs").is_none());
    assert_eq!(b.public(&b.db["users"][1])["decorations"]["avatar"], doc());
    assert_eq!(
        b.request(listing(&wearer, "catalog")).unwrap()["items"],
        json!([])
    );
    assert_eq!(
        b.request(listing(&wearer, "personal")).unwrap()["items"][0]["id"],
        *id
    );
    assert_eq!(
        b.request(req("apply_profile_effect", &stranger))
            .unwrap_err(),
        NOT_FOUND
    );
    let overwritten = b.request(json!({"op":"set_profile_decoration","token":wearer,"target":"avatar","decoration":doc()})).unwrap();
    assert!(overwritten["user"].get("decorationRefs").is_none());
    assert_eq!(
        b.request(req("apply_profile_effect", &wearer)).unwrap()["user"]["decorationRefs"]
            ["avatar"],
        *id
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn rejects_unvalidated_documents_and_rolls_back_failed_apply() {
    let (mut b, path, owner, wearer, _) = fixture();
    let create = |doc| json!({"op":"create_profile_effect","token":owner,"title":"Ember","target":"avatar","decoration":doc});
    let mut invalid = doc();
    invalid["layers"][0]["url"] = json!("https://example.invalid");
    assert_eq!(b.request(create(invalid)).unwrap_err(), INVALID);
    let id = b.request(create(doc())).unwrap()["item"]["id"].clone();
    b.request(json!({"op":"publish_profile_effect","token":owner,"id":id}))
        .unwrap();
    let before = b.db.clone();
    std::fs::create_dir(path.with_extension("tmp")).unwrap();
    let request = json!({"op":"apply_profile_effect","token":wearer,"id":id});
    assert_eq!(b.request(request).unwrap_err(), "STORAGE_UNAVAILABLE");
    assert_eq!(b.db, before);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn paginates_before_returning_documents_and_authenticates_first() {
    let (mut b, path, owner, _, _) = fixture();
    let list = |offset| json!({"op":"list_profile_effects","token":owner,"scope":"personal","target":"avatar","offset":offset,"limit":1});
    let mut unauthorized = list(0);
    unauthorized["token"] = json!("bad");
    assert_eq!(b.request(unauthorized).unwrap_err(), "AUTH_REQUIRED");
    for name in ["A", "B"] {
        b.request(json!({"op":"create_profile_effect","token":owner,"title":name,"target":"avatar","decoration":doc()})).unwrap();
    }
    let first = b.request(list(0)).unwrap();
    let second = b.request(list(1)).unwrap();
    assert_eq!(first["nextOffset"], 1);
    assert!(second["nextOffset"].is_null());
    assert_ne!(first["items"][0]["id"], second["items"][0]["id"]);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
