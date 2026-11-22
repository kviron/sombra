use super::*;

struct Fixture {
    b: Backend,
    path: PathBuf,
    owner: Value,
    owner_token: String,
    bot: Value,
    bot_token: String,
    other_bot_token: String,
    channel: Value,
}

/// One owner-authored pending update for the bot, plus a second bot without updates.
fn fixture() -> Fixture {
    let path = std::env::temp_dir().join(id()).join("db.json");
    let mut b = Backend::open(path.clone()).unwrap();
    let owner = b.db["users"][0].clone();
    let owner_token = b.token(&owner, "activity", false).unwrap();
    let group = b.db["groups"][0]["id"].clone();
    let channel = b.db["groups"][0]["channels"][0]["id"].clone();
    let bot = b
        .request(json!({"op":"create_bot","token":owner_token,"group":group,"name":"Helper","username":"activitybot"}))
        .unwrap();
    let bot_token = bot["token"].as_str().unwrap().to_owned();
    let other_group = b
        .request(json!({"op":"create_group","token":owner_token,"name":"Second room"}))
        .unwrap()["id"]
        .clone();
    let other = b
        .request(json!({"op":"create_bot","token":owner_token,"group":other_group,"name":"Other","username":"otherbot"}))
        .unwrap();
    let other_bot_token = other["token"].as_str().unwrap().to_owned();
    let message =
        json!({"id":id(),"channel":channel,"user":owner["id"],"text":"/ask hello","time":now()});
    b.db["messages"]
        .as_array_mut()
        .unwrap()
        .push(message.clone());
    b.enqueue_bots(&message).unwrap();
    Fixture {
        b,
        path,
        owner,
        owner_token,
        bot,
        bot_token,
        other_bot_token,
        channel,
    }
}

fn typing(bot_token: &str, update_id: u64, fields: Value) -> Value {
    let mut request = json!({"op":"bot_typing","bot_token":bot_token,"update_id":update_id});
    if let Some(fields) = fields.as_object() {
        for (key, value) in fields {
            request[key] = value.clone();
        }
    }
    request
}

fn active(b: &mut Backend, token: &str) -> Vec<Value> {
    arr(&b.request(json!({"op":"state","token":token})).unwrap()["botTyping"])
}

fn sorted_keys(value: &Value) -> Vec<String> {
    let mut keys = value
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<String>>();
    keys.sort();
    keys
}

fn typing_row_keys() -> Vec<String> {
    [
        "activity",
        "bot",
        "channel",
        "started_at",
        "status",
        "until",
    ]
    .iter()
    .map(|key| key.to_string())
    .collect::<Vec<String>>()
}

#[test]
fn typing_series_publishes_activity_status_and_server_owned_start() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let owner_token = f.owner_token.clone();
    let bid = f.bot["bot"]["id"].clone();
    f.b.request(typing(&bt, 1, json!({}))).unwrap();
    let rows = active(&mut f.b, &owner_token);
    assert_eq!(rows.len(), 1);
    let row = rows[0].clone();
    assert_eq!(row["bot"], bid);
    assert_eq!(row["channel"], f.channel);
    // Absent optional fields are still a stable shape for the client: empty means "none".
    assert_eq!(row["activity"], "");
    assert_eq!(row["status"], "");
    assert_eq!(sorted_keys(&row), typing_row_keys());
    let started = row["started_at"].as_u64().unwrap();
    assert!(started > 0 && started <= now(), "{row}");
    assert!(row["until"].as_u64().unwrap() >= started + BOT_TYPING_TTL);
    assert!(!row.to_string().contains("update_id"));
    // A later refresh of the same series keeps the first start and carries the new label.
    f.b.bot_typing[0]["started_at"] = json!(started.saturating_sub(40));
    f.b.request(typing(
        &bt,
        1,
        json!({"activity":"tool","status":"Ищу в интернете"}),
    ))
    .unwrap();
    let row = active(&mut f.b, &owner_token)[0].clone();
    assert_eq!(row["started_at"], started.saturating_sub(40));
    assert_eq!(row["activity"], "tool");
    assert_eq!(row["status"], "Ищу в интернете");
    // An expired window starts a new series: no stale start and no stale label.
    f.b.bot_typing[0]["until"] = json!(now() - 1);
    f.b.request(typing(&bt, 1, json!({"activity":"image"})))
        .unwrap();
    let row = active(&mut f.b, &owner_token)[0].clone();
    assert!(row["started_at"].as_u64().unwrap() > started.saturating_sub(40));
    assert_eq!(row["activity"], "image");
    assert_eq!(row["status"], "");
    // `typing:false` closes the window immediately.
    f.b.request(typing(&bt, 1, json!({"typing":false})))
        .unwrap();
    assert!(f.b.bot_typing.is_empty());
    assert!(active(&mut f.b, &owner_token).is_empty());
    // Ack drops the window even without a stop call.
    f.b.request(typing(
        &bt,
        1,
        json!({"activity":"thinking","status":"Думаю"}),
    ))
    .unwrap();
    assert_eq!(f.b.visible_bot_typing(s(&f.owner, "id")).len(), 1);
    f.b.request(json!({"op":"bot_ack","bot_token":bt,"update_id":1}))
        .unwrap();
    assert!(f.b.bot_typing.is_empty());
    assert!(active(&mut f.b, &owner_token).is_empty());
    drop(f.b);
    std::fs::remove_dir_all(f.path.parent().unwrap()).unwrap();
}

#[test]
fn strict_typing_validation_refuses_unknown_codes_and_client_start() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let channel = f.channel.clone();
    f.b.request(typing(&bt, 1, json!({"activity":"search","status":"Ищу"})))
        .unwrap();
    let before = f.b.bot_typing.clone();
    for bad in [
        json!({"stage":"image"}),
        json!({"started_at":1234}),
        json!({"startedAt":1234}),
        json!({"channel":channel}),
        json!({"activity":"plotting"}),
        json!({"activity":"THINKING"}),
        json!({"activity":""}),
        json!({"activity":5}),
        json!({"activity":null}),
        json!({"activity":["thinking"]}),
        json!({"status":"a".repeat(81)}),
        json!({"status":"я".repeat(81)}),
        json!({"status":"line\nbreak"}),
        json!({"status":"tab\tbreak"}),
        json!({"status":"bell\u{7}"}),
        json!({"status":"del\u{7f}"}),
        json!({"status":"c1\u{9f}"}),
        json!({"status":5}),
        json!({"status":null}),
        json!({"typing":"yes"}),
        json!({"typing":1}),
        json!({"until":"soon"}),
        json!({"until":null}),
        json!({"activity":"thinking","extra":true}),
        json!({"typing":false,"status":"closed\nbut unsafe"}),
    ] {
        assert_eq!(
            f.b.request(typing(&bt, 1, bad.clone())).unwrap_err(),
            "BOT_OUTPUT_INVALID",
            "payload {bad}"
        );
        assert_eq!(
            f.b.bot_typing, before,
            "refused payload changed typing: {bad}"
        );
    }
    // Every declared code and both length boundaries are accepted.
    for activity in BOT_ACTIVITIES {
        f.b.request(typing(&bt, 1, json!({"activity":activity})))
            .unwrap();
        assert_eq!(f.b.bot_typing[0]["activity"], *activity);
    }
    f.b.request(typing(&bt, 1, json!({"status":"a".repeat(80)})))
        .unwrap();
    assert_eq!(f.b.bot_typing[0]["status"], "a".repeat(80));
    f.b.request(typing(&bt, 1, json!({"status":"я".repeat(80)})))
        .unwrap();
    assert_eq!(f.b.bot_typing[0]["status"], "я".repeat(80));
    f.b.request(typing(&bt, 1, json!({"status":""}))).unwrap();
    assert_eq!(f.b.bot_typing[0]["status"], "");
    // A client-asserted expiry never extends or shortens the server window.
    f.b.bot_typing[0]["until"] = json!(now() + 1_000_000);
    let before = now();
    f.b.request(typing(&bt, 1, json!({"until":now() + 1_000_000})))
        .unwrap();
    let until = f.b.bot_typing[0]["until"].as_u64().unwrap();
    assert!(until <= before + BOT_TYPING_TTL + 1, "until {until}");
    f.b.request(typing(&bt, 1, json!({"until":0}))).unwrap();
    let until = f.b.bot_typing[0]["until"].as_u64().unwrap();
    assert!(until > before, "a client cannot close the window early");
    drop(f.b);
    std::fs::remove_dir_all(f.path.parent().unwrap()).unwrap();
}

#[test]
fn typing_stays_scoped_to_the_own_live_update_and_its_audience() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let owner_token = f.owner_token.clone();
    let other_bot_token = f.other_bot_token.clone();
    // A human session and an empty Bearer never reach the bot transport.
    assert_eq!(
        f.b.request(json!({"op":"bot_typing","token":owner_token,"update_id":1}))
            .unwrap_err(),
        "AUTH_REQUIRED"
    );
    // Another bot's token cannot address this bot's update; unknown ids stay unknown.
    assert_eq!(
        f.b.request(typing(&other_bot_token, 1, json!({"activity":"thinking"})))
            .unwrap_err(),
        "BOT_SOURCE_UNAVAILABLE"
    );
    assert_eq!(
        f.b.request(typing(&bt, 999, json!({"activity":"thinking"})))
            .unwrap_err(),
        "BOT_SOURCE_UNAVAILABLE"
    );
    assert!(f.b.bot_typing.is_empty());
    // The real update works, but an outsider without access never sees it in state.
    f.b.request(typing(
        &bt,
        1,
        json!({"activity":"code","status":"Пишу код"}),
    ))
    .unwrap();
    // This test is about who can see a live row, not about the server-owned eight-second
    // window: a loaded parallel run can take longer than that between the call above and the
    // assertions below. Keep the row alive so the checks only exercise audience scoping; the
    // TTL itself stays covered by `typing_series_publishes_activity_status_and_server_owned_start`.
    assert_eq!(f.b.bot_typing.len(), 1);
    f.b.bot_typing[0]["until"] = json!(now() + 3600);
    let outsider = f
        .b
        .request(json!({"op":"register","name":"Outsider","email":format!("outsider-{}@test.local", id()),"password":"strong-password"}))
        .unwrap()["user"]
        .clone();
    let outsider_token = f.b.token(&outsider, "outsider", false).unwrap();
    assert!(active(&mut f.b, &outsider_token).is_empty());
    assert_eq!(active(&mut f.b, &owner_token).len(), 1);
    // A cancelled source stops the activity row for everyone.
    let message_id = f.b.db["messages"][0]["id"].clone();
    f.b.request(json!({"op":"update_message","token":owner_token,"message":message_id,"text":"/ask changed"}))
        .unwrap();
    assert!(active(&mut f.b, &owner_token).is_empty());
    assert_eq!(
        f.b.request(typing(&bt, 1, json!({"activity":"thinking"})))
            .unwrap_err(),
        "BOT_SOURCE_UNAVAILABLE"
    );
    drop(f.b);
    std::fs::remove_dir_all(f.path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn http_state_shape_and_strict_typing_status_codes() {
    let f = fixture();
    let bt = f.bot_token.clone();
    let owner_token = f.owner_token.clone();
    let path = f.path.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api", listener.local_addr().unwrap());
    let backend = f.b;
    let server =
        tokio::spawn(async move { axum::serve(listener, api_router(backend)).await.unwrap() });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let valid = json!({"op":"bot_typing","update_id":1,"typing":true,"activity":"image","status":"Рисую карточку"});
    let response = client
        .post(&url)
        .bearer_auth(&bt)
        .json(&valid)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(
        response.json::<Value>().await.unwrap()["data"],
        json!({"ok":true})
    );
    let response = client
        .post(&url)
        .header("cookie", format!("mines_session={owner_token}"))
        .json(&json!({"op":"state"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body = response.text().await.unwrap();
    assert!(!body.contains(bt.as_str()));
    assert!(!body.contains("token_hash"));
    let state: Value = serde_json::from_str(&body).unwrap();
    let rows = arr(&state["data"]["botTyping"]);
    assert_eq!(rows.len(), 1);
    assert_eq!(sorted_keys(&rows[0]), typing_row_keys());
    assert_eq!(rows[0]["activity"], "image");
    assert_eq!(rows[0]["status"], "Рисую карточку");
    assert!(rows[0]["started_at"].as_u64().unwrap() > 0);
    // Unknown keys, unknown codes and control characters are rejected without side effects.
    for bad in [
        json!({"op":"bot_typing","update_id":1,"activity":"plotting"}),
        json!({"op":"bot_typing","update_id":1,"status":"bad\nlabel"}),
        json!({"op":"bot_typing","update_id":1,"started_at":1}),
        json!({"op":"bot_typing","update_id":1,"stage":"image"}),
    ] {
        let response = client
            .post(&url)
            .bearer_auth(&bt)
            .json(&bad)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 400, "{bad}");
        assert_eq!(
            response.json::<Value>().await.unwrap()["error"],
            "BOT_OUTPUT_INVALID"
        );
    }
    // A human cookie alone is not a bot credential.
    let response = client
        .post(&url)
        .header("cookie", format!("mines_session={owner_token}"))
        .json(&json!({"op":"bot_typing","update_id":1}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
    server.abort();
    let _ = server.await;
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
