use super::*;
fn fixture() -> (Backend, PathBuf, String) {
    let path = std::env::temp_dir().join(id()).join("db.json");
    let mut b = Backend::open(path.clone()).unwrap();
    let owner = b.db["users"][0].clone();
    let token = b.token(&owner, "decorations", false).unwrap();
    // One ordinary request settles the lazy read-sequence migration so later snapshots compare cleanly.
    b.request(json!({"op":"me","token":token})).unwrap();
    (b, path, token)
}
fn avatar_doc() -> Value {
    json!({"v":1,"target":"avatar","seed":19,"layers":[{"effect":"holy/divine-shield","palette":"ember","anchor":"ring","intensity":0.9}]})
}
fn cover_scene() -> Value {
    json!({"v":1,"target":"cover","mode":"scene","loop":true,"seed":11,"layers":[{"effect":"weather/aurora","palette":"aurora","anchor":"fill","intensity":0.75},{"effect":"sombra/runner","palette":"ice","anchor":"runner","intensity":0.9}]})
}
fn set(token: &str, target: &str, decoration: &Value) -> Value {
    json!({"op":"set_profile_decoration","token":token,"target":target,"decoration":decoration})
}
fn keys(value: &Value) -> Vec<String> {
    let mut keys = value
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<String>>();
    keys.sort();
    keys
}
#[tokio::test]
async fn http_human_cookie_only_own_account_and_safe_response() {
    let (mut b, path, token) = fixture();
    let owner_id = b.db["users"][0]["id"].clone();
    let guest = json!({"id":id(),"name":"Guest","active":true});
    b.db["users"].as_array_mut().unwrap().push(guest.clone());
    let guest_token = b.token(&guest, "guest", false).unwrap();
    let bot = json!({"id":id(),"bot":true});
    b.db["users"].as_array_mut().unwrap().push(bot.clone());
    let bot_token = b.token(&bot, "bot", false).unwrap();
    b.save().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, api_router(b)).await.unwrap() });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let owner_cookie = format!("mines_session={token}");
    let guest_cookie = format!("mines_session={guest_token}");
    // The human session cookie alone is enough, and only the account's own profile is written.
    let response = client
        .post(&url)
        .header("cookie", &owner_cookie)
        .json(&json!({"op":"set_profile_decoration","target":"avatar","decoration":avatar_doc()}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200, "the cookie session must be enough");
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body: Value = response.json().await.unwrap();
    let user = body["data"]["user"].clone();
    assert_eq!(user["id"], owner_id);
    assert_eq!(user["decorationSupported"], true);
    assert_eq!(user["decorations"]["avatar"], avatar_doc());
    assert_eq!(keys(&user["decorations"]), vec!["avatar"]);
    assert_eq!(keys(&body["data"]), vec!["user"]);
    assert!(!body.to_string().contains("hash"));
    assert!(!body.to_string().contains("salt"));
    // A body token never replaces the cookie session, and a bearer bot token is not a human.
    let without_cookie = json!({"op":"set_profile_decoration","target":"cover","decoration":cover_scene(),"token":token,"requester_id":owner_id,"user":owner_id});
    let response = client
        .post(&url)
        .json(&without_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
    let response = client
        .post(&url)
        .bearer_auth(bot_token.as_str())
        .json(&json!({"op":"set_profile_decoration","target":"avatar","decoration":avatar_doc()}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        401,
        "a bot token must never touch a profile"
    );
    let bot_cookie = format!("mines_session={bot_token}");
    let response = client
        .post(&url)
        .header("cookie", &bot_cookie)
        .json(&json!({"op":"set_profile_decoration","target":"avatar","decoration":avatar_doc()}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        401,
        "a bot account can never own a decoration"
    );
    // There is no field that could address somebody else's account.
    for extra in ["user", "requester_id", "owner", "id"] {
        let mut request =
            json!({"op":"set_profile_decoration","target":"avatar","decoration":avatar_doc()});
        request[extra] = owner_id.clone();
        let response = client
            .post(&url)
            .header("cookie", &guest_cookie)
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 400, "{extra} must be refused");
        assert_eq!(
            response.json::<Value>().await.unwrap()["error"],
            "PROFILE_DECORATION_INVALID"
        );
    }
    // The guest writes only their own profile, and the owner's document survives it.
    let response = client
        .post(&url)
        .header("cookie", &guest_cookie)
        .json(&json!({"op":"set_profile_decoration","target":"cover","decoration":cover_scene()}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let guest_user: Value = response.json().await.unwrap();
    assert_eq!(
        guest_user["data"]["user"]["decorations"]["cover"],
        cover_scene()
    );
    assert!(guest_user["data"]["user"]["decorations"]
        .get("avatar")
        .is_none());
    // `me`, `state` and the public user list expose the documents and the capability flag only.
    let response = client
        .post(&url)
        .header("cookie", &owner_cookie)
        .json(&json!({"op":"me"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let me: Value = response.json().await.unwrap();
    assert_eq!(me["data"]["user"]["decorations"]["avatar"], avatar_doc());
    assert_eq!(me["data"]["user"]["decorationSupported"], true);
    let response = client
        .post(&url)
        .header("cookie", &owner_cookie)
        .json(&json!({"op":"state"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let state: Value = response.json().await.unwrap();
    let state = state["data"].clone();
    assert_eq!(state["decorationSupported"], true);
    assert!(!state.to_string().contains("hash"));
    let rows = arr(&state["users"]);
    let owner_row = rows.iter().find(|row| row["id"] == owner_id).unwrap();
    assert_eq!(owner_row["decorations"]["avatar"], avatar_doc());
    assert_eq!(owner_row["decorationSupported"], true);
    let guest_row = rows.iter().find(|row| row["id"] == guest["id"]).unwrap();
    assert_eq!(guest_row["decorations"]["cover"], cover_scene());
    assert!(state.to_string().contains("holy/divine-shield"));
    server.abort();
    let _ = server.await;
    // Everything above is durable and target-scoped on disk.
    let reopened = Backend::open(path.clone()).unwrap();
    let owners = arr(&reopened.db["users"]);
    let owner_row = owners.iter().find(|row| row["id"] == owner_id).unwrap();
    assert_eq!(owner_row["decorations"]["avatar"], avatar_doc());
    assert!(owner_row["decorations"].get("cover").is_none());
    let guest_row = owners.iter().find(|row| row["id"] == guest["id"]).unwrap();
    assert_eq!(guest_row["decorations"]["cover"], cover_scene());
    assert!(guest_row["decorations"].get("avatar").is_none());
    drop(reopened);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn null_removes_only_its_target_and_targets_stay_independent() {
    let (mut b, path, token) = fixture();
    let state = b.request(json!({"op":"state","token":token})).unwrap();
    assert_eq!(state["decorationSupported"], true);
    let uid = b.db["users"][0]["id"].clone();
    let me = arr(&state["users"])
        .into_iter()
        .find(|row| row["id"] == uid)
        .unwrap();
    assert_eq!(me["decorationSupported"], true);
    assert!(
        me.get("decorations").is_none(),
        "an untouched profile has none"
    );
    assert_eq!(
        b.request(json!({"op":"me","token":token})).unwrap()["user"]["decorationSupported"],
        true
    );
    assert!(b.db["users"][0].get("decorations").is_none());
    let saved = b.request(set(&token, "avatar", &avatar_doc())).unwrap();
    assert_eq!(saved["user"]["decorations"]["avatar"], avatar_doc());
    let saved = b.request(set(&token, "cover", &cover_scene())).unwrap();
    assert_eq!(saved["user"]["decorations"]["cover"], cover_scene());
    assert_eq!(saved["user"]["decorations"]["avatar"], avatar_doc());
    assert_eq!(
        b.db["users"][0]["decorations"].as_object().unwrap().len(),
        2
    );
    let replacement = json!({"v":1,"target":"avatar","layers":[{"effect":"critters/slime","anchor":"bottom-right"}]});
    let saved = b.request(set(&token, "avatar", &replacement)).unwrap();
    assert_eq!(saved["user"]["decorations"]["avatar"], replacement);
    assert_eq!(saved["user"]["decorations"]["cover"], cover_scene());
    // `null` removes just one target.
    let saved = b.request(set(&token, "cover", &Value::Null)).unwrap();
    assert!(saved["user"]["decorations"].get("cover").is_none());
    assert_eq!(saved["user"]["decorations"]["avatar"], replacement);
    assert_eq!(
        b.db["users"][0]["decorations"].as_object().unwrap().len(),
        1
    );
    // Removing the last target drops the field entirely, exactly like an old account that never had it.
    let saved = b.request(set(&token, "avatar", &Value::Null)).unwrap();
    assert!(saved["user"].get("decorations").is_none());
    assert!(b.db["users"][0].get("decorations").is_none());
    let before = b.db.clone();
    b.request(set(&token, "avatar", &Value::Null)).unwrap();
    assert_eq!(b.db, before, "removing nothing must not add an empty field");
    b.request(set(&token, "cover", &cover_scene())).unwrap();
    drop(b);
    let mut reopened = Backend::open(path.clone()).unwrap();
    assert_eq!(
        reopened.db["users"][0]["decorations"]["cover"],
        cover_scene()
    );
    let saved = reopened
        .request(set(&token, "cover", &Value::Null))
        .unwrap();
    assert!(saved["user"].get("decorations").is_none());
    assert!(reopened.db["users"][0].get("decorations").is_none());
    drop(reopened);
    let reopened = Backend::open(path.clone()).unwrap();
    assert!(reopened.db["users"][0].get("decorations").is_none());
    drop(reopened);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn strict_document_validation_refuses_every_unsafe_shape() {
    let (mut b, path, token) = fixture();
    b.request(set(&token, "avatar", &avatar_doc())).unwrap();
    let before = b.db.clone();
    let four_layers = json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield"},{"effect":"holy/divine-shield"},{"effect":"holy/divine-shield"},{"effect":"holy/divine-shield"}]});
    let thirteen = json!([
        "#111", "#222", "#333", "#444", "#555", "#666", "#777", "#888", "#999", "#aaa", "#bbb",
        "#ccc", "#ddd"
    ]);
    let cases = vec![
        // Not a document at all.
        ("avatar", json!("holy/divine-shield")),
        ("avatar", json!(7)),
        ("avatar", json!(true)),
        ("avatar", json!([{"effect":"holy/divine-shield"}])),
        ("avatar", json!({})),
        // Version.
        (
            "avatar",
            json!({"target":"avatar","layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "avatar",
            json!({"v":2,"target":"avatar","layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "avatar",
            json!({"v":"1","target":"avatar","layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "avatar",
            json!({"v":1.0,"target":"avatar","layers":[{"effect":"holy/divine-shield"}]}),
        ),
        // Target must match the operation argument exactly.
        (
            "avatar",
            json!({"v":1,"target":"cover","layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatars","layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "cover",
            json!({"v":1,"target":"avatar","layers":[{"effect":"weather/aurora","anchor":"fill"}]}),
        ),
        ("chat", avatar_doc()),
        // Mode: known values only, `scene` only on the cover.
        (
            "avatar",
            json!({"v":1,"target":"avatar","mode":"scene","layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "cover",
            json!({"v":1,"target":"cover","mode":"movie","layers":[{"effect":"weather/aurora","anchor":"fill"}]}),
        ),
        (
            "cover",
            json!({"v":1,"target":"cover","mode":true,"layers":[{"effect":"weather/aurora","anchor":"fill"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","mode":null,"layers":[{"effect":"holy/divine-shield"}]}),
        ),
        // Loop and seed.
        (
            "avatar",
            json!({"v":1,"target":"avatar","loop":"yes","layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","seed":-1,"layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","seed":4294967296u64,"layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","seed":1.5,"layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","seed":"1","layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","seed":null,"layers":[{"effect":"holy/divine-shield"}]}),
        ),
        // Layers: array, 1–3 entries, objects only.
        ("avatar", json!({"v":1,"target":"avatar","layers":[]})),
        ("avatar", json!({"v":1,"target":"avatar","layers":{}})),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":"holy/divine-shield"}),
        ),
        ("avatar", json!({"v":1,"target":"avatar","layers":[1]})),
        ("avatar", json!({"v":1,"target":"avatar","layers":[[]]})),
        ("avatar", four_layers),
        // Effect whitelist and effect/target pairing.
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield-2"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"fire/fire-ring"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":""}]}),
        ),
        ("avatar", json!({"v":1,"target":"avatar","layers":[{}]})),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":["holy/divine-shield"]}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"weather/aurora","anchor":"fill"}]}),
        ),
        (
            "cover",
            json!({"v":1,"target":"cover","layers":[{"effect":"critters/slime","anchor":"bottom-right"}]}),
        ),
        (
            "cover",
            json!({"v":1,"target":"cover","layers":[{"effect":"holy/divine-shield","anchor":"ring"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"sombra/runner","anchor":"runner"}]}),
        ),
        (
            "cover",
            json!({"v":1,"target":"cover","mode":"frame","layers":[{"effect":"sombra/runner","anchor":"runner"}]}),
        ),
        (
            "cover",
            json!({"v":1,"target":"cover","layers":[{"effect":"sombra/runner","anchor":"runner"}]}),
        ),
        // Anchors: whitelist plus the effect/target subset.
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","anchor":"center"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","anchor":"fill"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"critters/slime","anchor":"ring"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"critters/slime","anchor":"runner"}]}),
        ),
        (
            "cover",
            json!({"v":1,"target":"cover","layers":[{"effect":"weather/aurora","anchor":"ring"}]}),
        ),
        (
            "cover",
            json!({"v":1,"target":"cover","mode":"scene","layers":[{"effect":"sombra/runner","anchor":"fill"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","anchor":5}]}),
        ),
        // Palettes: named list or a 3–12 entry #rgb/#rrggbb ramp.
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"critters/slime","palette":"slime"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","palette":"Ember"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","palette":""}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","palette":"url(#x)"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","palette":["#111","#222"]}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","palette":thirteen}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","palette":["red","#222","#333"]}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","palette":["#ggg","#222","#333"]}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","palette":["#1111","#222","#333"]}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","palette":[1,2,3]}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","palette":{"kind":"named","name":"ember"}}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","palette":"#fff"}]}),
        ),
        // Numbers are range-checked, never clamped.
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","intensity":-0.01}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","intensity":1.01}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","intensity":"0.5"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","intensity":true}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","intensity":null}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","scale":0.49}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","scale":2.01}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","scale":"1"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","flip":"yes"}]}),
        ),
        // Unknown and extra keys are refused, not dropped.
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield"}],"url":"https://example.invalid/a.js"}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield"}],"eval":"alert(1)"}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield"}],"script":"<svg onload=alert(1)>"}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield"}],"decoration":avatar_doc()}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","text":"hi"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","onload":"alert(1)"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","color":"#fff"}]}),
        ),
        // Nothing nested beyond layers and the palette ramp.
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","extra":{"a":{"b":1}}}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield"}],"meta":{"a":{"b":{"c":1}}}}),
        ),
        // Size cap per target (4096 bytes), checked before anything is stored.
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield"}],"description":"A".repeat(5000)}),
        ),
    ];
    for (target, document) in cases {
        let error = b.request(set(&token, target, &document)).unwrap_err();
        assert_eq!(error, INVALID, "{target} document {document}");
        assert_eq!(
            b.db, before,
            "a rejected document must change nothing: {document}"
        );
    }
    // Missing `decoration`, unknown operation targets and unknown request keys.
    for request in [
        json!({"op":"set_profile_decoration","token":token,"target":"avatar"}),
        json!({"op":"set_profile_decoration","token":token,"decoration":avatar_doc()}),
        json!({"op":"set_profile_decoration","token":token,"target":"avatar","targets":["cover"],"decoration":avatar_doc()}),
        json!({"op":"set_profile_decoration","token":token,"target":"avatar","decoration":avatar_doc(),"theme":"dark"}),
        json!({"op":"set_profile_decoration","token":token,"target":"avatar","decoration":avatar_doc(),"requester_id":id()}),
    ] {
        assert_eq!(
            b.request(request.clone()).unwrap_err(),
            INVALID,
            "{request}"
        );
        assert_eq!(b.db, before, "{request}");
    }
    // Documents that stay inside the contract are stored exactly as sent.
    let ramp = json!([
        "#081a1e", "#0d3a36", "#13664e", "#1fa06a", "#3fd88e", "#9af7bf", "#e6fff0", "#FFFFFF",
        "#fff", "#000", "#171717", "#262626"
    ]);
    for (target, document) in [
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"critters/slime"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","mode":"frame","loop":false,"seed":0,"layers":[{"effect":"holy/divine-shield","palette":["#fff","#000","#ABC"],"anchor":"ring","intensity":0,"scale":0.5,"flip":true}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","seed":4294967295u64,"layers":[{"effect":"critters/slime","palette":ramp,"anchor":"top-left","intensity":1,"scale":2},{"effect":"critters/slime","anchor":"bottom-left"},{"effect":"holy/divine-shield","palette":"neon"}]}),
        ),
        ("cover", cover_scene()),
        (
            "cover",
            json!({"v":1,"target":"cover","layers":[{"effect":"weather/aurora","palette":"leaf","anchor":"fill","scale":2,"intensity":1}]}),
        ),
    ] {
        let saved = b.request(set(&token, target, &document)).unwrap();
        assert_eq!(saved["user"]["decorations"][target], document);
        assert_eq!(b.db["users"][0]["decorations"][target], document);
        let stored = serde_json::to_vec(&b.db["users"][0]["decorations"][target]).unwrap();
        assert!(stored.len() <= MAX_BYTES, "stored size {}", stored.len());
    }
    assert_eq!(MAX_BYTES, 4096);
    drop(b);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn size_cap_storage_failure_and_reopen_persistence() {
    let (mut b, path, token) = fixture();
    b.request(set(&token, "avatar", &avatar_doc())).unwrap();
    let snapshot = b.db.clone();
    let oversized = json!({"v":1,"target":"cover","layers":[{"effect":"weather/aurora","anchor":"fill"}],"pad":"A".repeat(4096)});
    assert_eq!(
        b.request(set(&token, "cover", &oversized)).unwrap_err(),
        INVALID
    );
    assert_eq!(b.db, snapshot, "an oversized document is never written");
    // A failed write restores the previous record and keeps the stored document.
    let saved_path = b.path.clone();
    b.path = path.parent().unwrap().to_path_buf();
    let replacement = json!({"v":1,"target":"avatar","layers":[{"effect":"critters/slime","anchor":"top-right"}]});
    assert_eq!(
        b.request(set(&token, "avatar", &replacement)).unwrap_err(),
        "STORAGE_UNAVAILABLE"
    );
    assert_eq!(b.db, snapshot, "a failed save must roll the record back");
    b.path = saved_path;
    let _ = std::fs::remove_file(path.parent().unwrap().with_extension("tmp"));
    assert_eq!(
        b.request(json!({"op":"me","token":token})).unwrap()["user"]["decorations"]["avatar"],
        avatar_doc()
    );
    // The document survives a database rewrite/reopen, and old rows without the field read as none.
    b.db["users"][0]
        .as_object_mut()
        .unwrap()
        .remove("decorations");
    b.save().unwrap();
    drop(b);
    let mut b = Backend::open(path.clone()).unwrap();
    assert!(b.db["users"][0].get("decorations").is_none());
    assert!(b.request(json!({"op":"me","token":token})).unwrap()["user"]
        .get("decorations")
        .is_none());
    b.request(set(&token, "cover", &cover_scene())).unwrap();
    drop(b);
    let mut reopened = Backend::open(path.clone()).unwrap();
    assert_eq!(
        reopened.db["users"][0]["decorations"]["cover"],
        cover_scene()
    );
    assert_eq!(
        reopened.request(json!({"op":"me","token":token})).unwrap()["user"]["decorations"]["cover"],
        cover_scene()
    );
    // A hand-edited or future record cannot leak unknown keys or targets to other clients.
    reopened.db["users"][0]["decorations"]["avatar"] =
        json!({"v":1,"target":"avatar","layers":[{"effect":"critters/slime"}],"evil":"x"});
    reopened.db["users"][0]["decorations"]["background"] =
        json!({"v":1,"target":"background","layers":[]});
    reopened.db["users"][0]["decorations"]["meta"] = json!({"note":"x"});
    reopened.save().unwrap();
    let me = reopened.request(json!({"op":"me","token":token})).unwrap();
    assert_eq!(keys(&me["user"]["decorations"]), vec!["cover"]);
    assert_eq!(me["user"]["decorations"]["cover"], cover_scene());
    assert!(!me.to_string().contains("evil"));
    assert!(!me.to_string().contains("background"));
    // Writing one target again discards the foreign keys from the stored record.
    let saved = reopened
        .request(set(&token, "avatar", &avatar_doc()))
        .unwrap();
    assert_eq!(keys(&saved["user"]["decorations"]), vec!["avatar", "cover"]);
    assert_eq!(
        keys(&reopened.db["users"][0]["decorations"]),
        vec!["avatar", "cover"]
    );
    drop(reopened);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn decorations_do_not_touch_identity_avatar_cover_or_other_records() {
    let (mut b, path, token) = fixture();
    let uid = b.db["users"][0]["id"].clone();
    let guest = json!({"id":id(),"name":"Guest","active":true,"bio":"hi"});
    b.db["users"].as_array_mut().unwrap().push(guest.clone());
    b.save().unwrap();
    let before = b.db.clone();
    b.request(set(&token, "avatar", &avatar_doc())).unwrap();
    b.request(set(&token, "cover", &cover_scene())).unwrap();
    for key in [
        "name",
        "email",
        "salt",
        "hash",
        "bio",
        "avatar",
        "profile_cover",
        "version",
        "created_at",
    ] {
        assert_eq!(
            b.db["users"][0][key], before["users"][0][key],
            "{key} unchanged"
        );
    }
    assert_eq!(
        b.db["users"][0].as_object().unwrap().len(),
        before["users"][0].as_object().unwrap().len() + 1,
        "only the decorations object may be added"
    );
    assert_eq!(
        b.db["users"][1], before["users"][1],
        "other users untouched"
    );
    for key in [
        "groups", "dialogs", "messages", "sessions", "friends", "stickers", "bots",
    ] {
        assert_eq!(b.db[key], before[key], "{key} untouched");
    }
    assert_eq!(arr(&b.db["users"]).len(), 2);
    // Ordinary profile editing keeps working and can never address the decoration field.
    assert!(b.request(json!({"op":"update_profile","token":token,"profile":{"name":"Renamed","bio":"","decorations":avatar_doc()}})).is_err());
    assert_eq!(b.db["users"][0]["decorations"]["avatar"], avatar_doc());
    b.request(
        json!({"op":"update_profile","token":token,"profile":{"name":"Renamed","bio":"new"}}),
    )
    .unwrap();
    assert_eq!(b.db["users"][0]["name"], "Renamed");
    assert_eq!(b.db["users"][0]["decorations"]["avatar"], avatar_doc());
    assert_eq!(b.db["users"][0]["decorations"]["cover"], cover_scene());
    // No files beyond the database and the first-user note are created for a decoration.
    let entries = std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
        .filter(|name| !name.starts_with("db.json") && !name.ends_with(".tmp"))
        .collect::<Vec<_>>();
    assert_eq!(entries, vec!["FIRST-USER.txt"], "{entries:?}");
    let guest_token = b.token(&guest, "guest", false).unwrap();
    let mut forged = set(&guest_token, "avatar", &avatar_doc());
    forged["user"] = json!(uid);
    assert_eq!(b.request(forged).unwrap_err(), INVALID);
    assert_eq!(b.db["users"][0]["decorations"]["avatar"], avatar_doc());
    assert!(b.db["users"][1].get("decorations").is_none());
    drop(b);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
