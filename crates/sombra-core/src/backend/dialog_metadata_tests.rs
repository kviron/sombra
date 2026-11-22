use super::*;

fn fixture() -> (Backend, Vec<String>) {
    let mut backend = Backend::open(std::env::temp_dir().join(id()).join("db.json")).unwrap();
    let mut tokens = Vec::new();
    for index in 0..4 {
        let user = if index == 0 {
            backend.db["users"][0].clone()
        } else {
            json!({"id":id(),"name":format!("User {index}")})
        };
        if index != 0 {
            backend.db["users"]
                .as_array_mut()
                .unwrap()
                .push(user.clone());
        }
        tokens.push(backend.token(&user, "dialog-test", false).unwrap());
    }
    let users = backend.db["users"].clone();
    backend.db["dialogs"] = json!([
        {"id":"group-dm","owner":users[0]["id"],"name":"Тройничок","members":[users[0]["id"],users[1]["id"],users[2]["id"]]},
        {"id":"direct","owner":users[0]["id"],"members":[users[0]["id"],users[1]["id"]]}
    ]);
    backend.save().unwrap();
    (backend, tokens)
}
fn patch(token: &str) -> Value {
    json!({"op":"update_dialog","token":token,"dialog":"group-dm","revision":0,"name":"  Новое Имя 🌑  "})
}
fn avatar() -> String {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(2, 2)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes.into_inner())
    )
}

#[test]
fn owner_rename_avatar_persist_and_peer_state() {
    let (mut backend, tokens) = fixture();
    let original_members = backend.db["dialogs"][0]["members"].clone();
    let mut request = patch(&tokens[0]);
    request["avatar"] = json!(avatar());
    let result = backend.request(request).unwrap();
    assert_eq!(result["name"], "Новое Имя 🌑");
    assert_eq!(result["revision"], 1);
    assert_eq!(result["members"], original_members);
    assert_eq!(result["avatar"], avatar());
    let path = backend.path.clone();
    drop(backend);
    let mut backend = Backend::open(path).unwrap();
    let state = backend
        .request(json!({"op":"state","token":tokens[1]}))
        .unwrap();
    assert_eq!(state["dialogMetadataSupported"], true);
    assert_eq!(state["dialogs"][0]["avatar"], result["avatar"]);
    assert_eq!(state["dialogs"][0]["revision"], 1);
    assert_eq!(state["dialogs"][0]["owner"], result["owner"]);
    backend.request(json!({"op":"update_dialog","token":tokens[0],"dialog":"group-dm","revision":1,"avatar":""})).unwrap();
    assert_eq!(backend.db["dialogs"][0]["avatar"], "");
}

#[test]
fn authorization_fails_closed_without_mutating_dialogs() {
    let (mut backend, tokens) = fixture();
    for token in [&tokens[1], &tokens[3]] {
        assert_eq!(backend.request(patch(token)), Err(FORBIDDEN.into()));
    }
    let mut request = patch(&tokens[0]);
    request["dialog"] = json!("direct");
    assert_eq!(backend.request(request), Err(FORBIDDEN.into()));
    let mut request = patch(&tokens[0]);
    request["dialog"] = json!("missing");
    assert_eq!(backend.request(request), Err(FORBIDDEN.into()));
    for request in [patch(""), patch("bot-bearer")] {
        assert_eq!(backend.request(request), Err("AUTH_REQUIRED".into()));
    }
    let mut request = patch(&tokens[0]);
    request["bot_token"] = json!("bearer");
    assert_eq!(backend.request(request), Err("AUTH_REQUIRED".into()));
    let original = backend.db["dialogs"].clone();
    backend.db["dialogs"][0]
        .as_object_mut()
        .unwrap()
        .remove("owner");
    assert_eq!(backend.request(patch(&tokens[0])), Err(FORBIDDEN.into()));
    backend.db["dialogs"] = original.clone();
    backend.db["dialogs"][0]["members"] = json!([
        backend.db["users"][1]["id"],
        backend.db["users"][2]["id"],
        backend.db["users"][3]["id"]
    ]);
    assert_eq!(backend.request(patch(&tokens[0])), Err(FORBIDDEN.into()));
    backend.db["dialogs"] = original.clone();
    let bot_id = backend.db["users"][2]["id"].clone();
    backend.db["users"][2]["bot"] = json!(true);
    backend.db["bots"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":bot_id}));
    assert_eq!(backend.request(patch(&tokens[0])), Err(FORBIDDEN.into()));
    assert_eq!(backend.db["dialogs"], original);
}

#[test]
fn invalid_patches_and_conflicts_leave_database_untouched() {
    let (mut backend, tokens) = fixture();
    for (key, values) in [
        (
            "name",
            vec![json!(" "), json!("x".repeat(61)), json!(null), json!(42)],
        ),
        (
            "revision",
            vec![json!(-1), json!(0.5), json!("0"), json!(null), json!(1)],
        ),
        (
            "avatar",
            vec![
                json!("https://example.com/a.png"),
                json!("file:///a.png"),
                json!("data:image/svg+xml;base64,PHN2Zz4="),
                json!("data:image/gif;base64,R0lGODlh"),
                json!("data:image/png;base64,aGVsbG8="),
                json!(format!("data:image/png;base64,{}", "A".repeat(700001))),
                json!(null),
            ],
        ),
        (
            "revision",
            vec![
                json!(null),
                json!("0"),
                json!(-1),
                json!(0.5),
                json!({}),
                json!(1),
            ],
        ),
        ("members", vec![json!([])]),
        ("owner", vec![json!("caller")]),
        ("id", vec![json!("foreign")]),
        ("arbitrary", vec![json!(true)]),
    ] {
        for value in values {
            let before = backend.db.clone();
            let mut request = patch(&tokens[0]);
            request[key] = value;
            assert!(backend.request(request).is_err(), "accepted {key}");
            assert_eq!(backend.db, before, "mutated for {key}");
        }
    }
    let mut request = patch(&tokens[0]);
    request.as_object_mut().unwrap().remove("revision");
    assert!(backend.request(request).is_err());
    let mut request = patch(&tokens[0]);
    request.as_object_mut().unwrap().remove("name");
    assert!(backend.request(request).is_err());
    backend.request(patch(&tokens[0])).unwrap();
    let before = backend.db.clone();
    assert_eq!(backend.request(patch(&tokens[0])), Err(CONFLICT.into()));
    assert_eq!(backend.db, before);
}

#[tokio::test]
async fn http_cookie_only_permissions_and_revision_status() {
    let (backend, tokens) = fixture();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api", listener.local_addr().unwrap());
    let server =
        tokio::spawn(async move { axum::serve(listener, api_router(backend)).await.unwrap() });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    for (token, dialog) in [
        (&tokens[1], "group-dm"),
        (&tokens[3], "group-dm"),
        (&tokens[0], "direct"),
        (&tokens[0], "missing"),
    ] {
        let mut request = patch(&tokens[0]);
        request["dialog"] = json!(dialog);
        let response = client
            .post(&url)
            .header("cookie", format!("mines_session={token}"))
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 403);
        assert_eq!(response.json::<Value>().await.unwrap()["error"], FORBIDDEN);
    }
    for bearer in [None, Some("BotBearer")] {
        let mut request = client.post(&url).json(&patch(&tokens[0]));
        if let Some(bearer) = bearer {
            request = request.bearer_auth(bearer);
        }
        assert_eq!(request.send().await.unwrap().status(), 401);
    }
    for expected in [200, 409] {
        assert_eq!(
            client
                .post(&url)
                .header("cookie", format!("mines_session={}", tokens[0]))
                .json(&patch(&tokens[3]))
                .send()
                .await
                .unwrap()
                .status(),
            expected
        );
    }
    let search = json!({"op":"search_conversation_members","channel":"group-dm","query":"user"});
    assert_eq!(
        client
            .post(&url)
            .json(&search)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        client
            .post(&url)
            .bearer_auth("BotBearer")
            .json(&search)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        client
            .post(&url)
            .header("cookie", format!("mines_session={}", tokens[3]))
            .json(&search)
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .post(&url)
            .header("cookie", format!("mines_session={}", tokens[1]))
            .json(&search)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    server.abort();
}

#[test]
fn member_search_scoped_exact_email_and_no_writes() {
    let (mut backend, tokens) = fixture();
    backend.db["users"][1]["email"] = json!("Private.Peer@example.test");
    backend.db["users"][1]["username"] = json!("PeerLogin");
    backend.db["users"][3]["email"] = json!("outsider@example.test");
    // Unprepared DB must remain unchanged even if normal state reads migrate it.
    backend.db["read_receipts"] = json!(null);
    let before = backend.db.clone();
    for query in ["peerlog", "USER 1", "  PRIVATE.PEER@EXAMPLE.TEST  "] {
        let result = backend.request(json!({"op":"search_conversation_members","token":tokens[0],"channel":"group-dm","query":query})).unwrap();
        assert_eq!(result["users"].as_array().unwrap().len(), 1);
        assert_eq!(result["users"][0]["id"], backend.db["users"][1]["id"]);
        assert!(result["users"][0].get("email").is_none());
        assert_eq!(backend.db, before);
    }
    for query in ["Private.Peer@", "outsider@example.test"] {
        assert_eq!(backend.request(json!({"op":"search_conversation_members","token":tokens[0],"channel":"group-dm","query":query})).unwrap()["users"], json!([]));
    }
    for (token, channel) in [
        (&tokens[3], "group-dm"),
        (&tokens[2], "direct"),
        (&tokens[0], "missing"),
    ] {
        assert_eq!(backend.request(json!({"op":"search_conversation_members","token":token,"channel":channel,"query":"user"})), Err("Нет доступа к участникам переписки".into()));
    }
    for query in [json!(""), json!("x".repeat(129)), json!(null)] {
        assert!(backend.request(json!({"op":"search_conversation_members","token":tokens[0],"channel":"direct","query":query})).is_err());
    }
    assert_eq!(backend.db, before);
}

#[test]
fn failed_save_rolls_back_metadata() {
    let (mut backend, tokens) = fixture();
    // A directory cannot be replaced by the JSON-file atomic rename.
    let directory = std::env::temp_dir().join(id());
    std::fs::create_dir_all(&directory).unwrap();
    backend.path = directory;
    let before = backend.db.clone();
    assert!(backend.request(patch(&tokens[0])).is_err());
    assert_eq!(backend.db, before);
}
