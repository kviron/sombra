use super::*;

struct Fixture {
    b: Backend,
    path: PathBuf,
    owner: Value,
    owner_token: String,
    channel: Value,
    bot: Value,
    bot_token: String,
    foreign_bot_token: String,
    owner_update: u64,
    guest_update: u64,
}

/// One owner-authored update and one ordinary-member update for the same modern bot,
/// plus a second bot in another group that never receives those ids.
fn fixture() -> Fixture {
    let path = std::env::temp_dir().join(id()).join("db.json");
    let mut b = Backend::open(path.clone()).unwrap();
    let owner = b.db["users"][0].clone();
    let owner_token = b.token(&owner, "owner-settings", false).unwrap();
    let group = b.db["groups"][0]["id"].clone();
    let channel = b.db["groups"][0]["channels"][0]["id"].clone();
    let bot = b
        .request(json!({"op":"create_bot","token":owner_token,"group":group,"name":"Helper","username":"ownerhelper"}))
        .unwrap();
    let bot_token = bot["token"].as_str().unwrap().to_owned();
    let guest = b
        .request(json!({"op":"register","name":"Member","email":format!("owner-settings-{}@test.local", id()),"password":"strong-password"}))
        .unwrap()["user"]
        .clone();
    b.db["groups"][0]["members"]
        .as_array_mut()
        .unwrap()
        .push(guest["id"].clone());
    let foreign_group = b
        .request(json!({"op":"create_group","token":owner_token,"name":"Elsewhere"}))
        .unwrap()["id"]
        .clone();
    let foreign = b
        .request(json!({"op":"create_bot","token":owner_token,"group":foreign_group,"name":"Elsewhere bot","username":"elsewherebot"}))
        .unwrap();
    let foreign_bot_token = foreign["token"].as_str().unwrap().to_owned();
    push_message(&mut b, &channel, &owner, "/ask hello");
    push_message(&mut b, &channel, &guest, "/ask hello from member");
    let updates = arr(&b.db["bot_updates"]);
    let bot_id = bot["bot"]["id"].clone();
    let owner_update = updates
        .iter()
        .find(|u| u["bot"] == bot_id && u["sender"]["id"] == owner["id"])
        .unwrap()["update_id"]
        .as_u64()
        .unwrap();
    let guest_update = updates
        .iter()
        .find(|u| u["bot"] == bot_id && u["sender"]["id"] == guest["id"])
        .unwrap()["update_id"]
        .as_u64()
        .unwrap();
    Fixture {
        b,
        path,
        owner,
        owner_token,
        channel,
        bot,
        bot_token,
        foreign_bot_token,
        owner_update,
        guest_update,
    }
}

/// A real queued update is required: the server never trusts an id without a source.
/// The read-state migration runs here so later database snapshots stay comparable.
fn push_message(b: &mut Backend, channel: &Value, user: &Value, text: &str) -> u64 {
    let message = json!({"id":id(),"channel":channel,"user":user["id"],"text":text,"time":now()});
    b.db["messages"]
        .as_array_mut()
        .unwrap()
        .push(message.clone());
    b.enqueue_bots(&message).unwrap();
    b.normalize_read_sequences().unwrap();
    b.save().unwrap();
    b.db["bots"][0]["seq"].as_u64().unwrap()
}

fn owner_call(bot_token: &str, update_id: Value, fields: Value) -> Value {
    let mut request =
        json!({"op":"bot_owner_update_settings","bot_token":bot_token,"update_id":update_id});
    if let Some(fields) = fields.as_object() {
        for (key, value) in fields {
            request[key] = value.clone();
        }
    }
    request
}

fn dto_keys() -> Vec<String> {
    [
        "bot",
        "model",
        "modelDefault",
        "reasoning",
        "reasoningDefault",
        "revision",
    ]
    .iter()
    .map(|key| key.to_string())
    .collect::<Vec<String>>()
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

fn update_row(b: &Backend, update_id: u64) -> Value {
    arr(&b.db["bot_updates"])
        .into_iter()
        .find(|u| u["update_id"] == update_id)
        .unwrap()
}

#[test]
fn owner_update_applies_once_and_refuses_foreign_completed_or_forged_sources() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let bid = f.bot["bot"]["id"].clone();
    let before = f.b.db["bots"][0].clone();
    let dto =
        f.b.request(owner_call(
            &bt,
            json!(f.owner_update),
            json!({"model":"openai-codex/gpt-6-luna","reasoning":"high"}),
        ))
        .unwrap();
    assert_eq!(dto["bot"], bid);
    assert_eq!(dto["model"], "openai-codex/gpt-6-luna");
    assert_eq!(dto["reasoning"], "high");
    assert_eq!(dto["revision"], 1);
    assert_eq!(dto["modelDefault"], false);
    assert_eq!(dto["reasoningDefault"], false);
    assert_eq!(
        sorted_keys(&dto),
        dto_keys(),
        "same DTO as bot_get_model_settings"
    );
    assert_eq!(
        f.b.db["bots"][0]["settings"],
        json!({"model":"openai-codex/gpt-6-luna","reasoning":"high","revision":1})
    );
    // The response is the same projection an owner reads over a cookie session.
    let owner_read =
        f.b.request(json!({"op":"bot_get_model_settings","token":f.owner_token,"bot":bid}))
            .unwrap();
    assert_eq!(owner_read, dto);
    // Only the model settings may ever move.
    for key in [
        "owner",
        "username",
        "commands",
        "groups",
        "group",
        "legacy",
        "enabled",
        "token_hash",
        "tool_policy",
        "seq",
        "ack",
        "name",
        "settings_revision",
        "privacy",
    ] {
        assert_eq!(f.b.db["bots"][0][key], before[key], "{key} must not change");
    }
    // The one-shot marker rides on the source update only.
    assert_eq!(update_row(&f.b, f.owner_update)[OWNER_APPLIED], true);
    assert!(update_row(&f.b, f.guest_update)
        .get(OWNER_APPLIED)
        .is_none());
    // The same update never applies twice, even before its ack.
    let consumed = f.b.db.clone();
    assert_eq!(
        f.b.request(owner_call(
            &bt,
            json!(f.owner_update),
            json!({"model":"claude-next","reasoning":"low"}),
        ))
        .unwrap_err(),
        "BOT_SETTINGS_CONFLICT"
    );
    assert_eq!(f.b.db, consumed);
    // An ordinary member's update is forbidden; the settings keep the owner's values.
    assert_eq!(
        f.b.request(owner_call(
            &bt,
            json!(f.guest_update),
            json!({"model":"member-chosen-model"}),
        ))
        .unwrap_err(),
        "BOT_SETTINGS_FORBIDDEN"
    );
    assert_eq!(f.b.db, consumed);
    // Foreign and unknown bots cannot address someone else's update, and update_id is mandatory.
    let foreign_bot_token = f.foreign_bot_token.clone();
    let unknown_update = f.owner_update + 100;
    for request in [
        owner_call(
            &foreign_bot_token,
            json!(f.owner_update),
            json!({"model":"x"}),
        ),
        owner_call(&bt, json!(unknown_update), json!({"model":"x"})),
        owner_call(&bt, json!("1"), json!({"model":"x"})),
        owner_call(&bt, Value::Null, json!({"model":"x"})),
        json!({"op":"bot_owner_update_settings","bot_token":bt,"model":"x"}),
    ] {
        let expected = if request["update_id"].as_u64().is_none() {
            "BOT_SETTINGS_INVALID"
        } else {
            "BOT_SETTINGS_FORBIDDEN"
        };
        assert_eq!(
            f.b.request(request.clone()).unwrap_err(),
            expected,
            "request {request}"
        );
        assert_eq!(f.b.db, consumed);
    }
    // A human cookie is not a bot credential for this path.
    assert_eq!(
        f.b.request(json!({"op":"bot_owner_update_settings","token":f.owner_token,"update_id":f.owner_update,"model":"x"}))
            .unwrap_err(),
        "AUTH_REQUIRED"
    );
    // Acking closes the update for settings as well.
    f.b.request(json!({"op":"bot_ack","bot_token":bt,"update_id":f.owner_update}))
        .unwrap();
    let acked = f.b.db.clone();
    assert_eq!(
        f.b.request(owner_call(
            &bt,
            json!(f.owner_update),
            json!({"model":"after-ack"})
        ))
        .unwrap_err(),
        "BOT_SETTINGS_CONFLICT"
    );
    assert_eq!(f.b.db, acked);
    // A fresh owner update still applies with its own CAS revision.
    let next = push_message(&mut f.b, &f.channel, &f.owner, "/ask model medium");
    assert_eq!(next, f.owner_update + 2);
    let dto =
        f.b.request(owner_call(
            &bt,
            json!(next),
            json!({"model":"openai-codex/gpt-6-luna","reasoning":"medium","revision":1}),
        ))
        .unwrap();
    assert_eq!(dto["reasoning"], "medium");
    assert_eq!(dto["revision"], 2);
    // A stale CAS is refused and does not consume the newer owner update.
    let fresh = push_message(&mut f.b, &f.channel, &f.owner, "/ask one more");
    let pending = f.b.db.clone();
    assert_eq!(
        f.b.request(owner_call(
            &bt,
            json!(fresh),
            json!({"model":"x","revision":0})
        ))
        .unwrap_err(),
        "BOT_SETTINGS_CONFLICT"
    );
    assert_eq!(f.b.db, pending);
    let dto =
        f.b.request(owner_call(
            &bt,
            json!(fresh),
            json!({"model":"x","revision":2}),
        ))
        .unwrap();
    assert_eq!(dto["revision"], 3);
    drop(f.b);
    std::fs::remove_dir_all(f.path.parent().unwrap()).unwrap();
}

#[test]
fn invalid_patches_are_atomic_and_do_not_consume_the_owner_update() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    f.b.request(owner_call(
        &bt,
        json!(f.owner_update),
        json!({"model":"openai-codex/gpt-6-luna"}),
    ))
    .unwrap();
    let next = push_message(&mut f.b, &f.channel, &f.owner, "/ask model high");
    let pending = f.b.db.clone();
    for (fields, expected) in [
        (json!({}), "BOT_SETTINGS_INVALID"),
        (json!({"unknown":"x"}), "BOT_SETTINGS_INVALID"),
        (json!({"provider":"openai"}), "BOT_SETTINGS_INVALID"),
        (json!({"bot":id()}), "BOT_SETTINGS_INVALID"),
        (json!({"owner":"forged"}), "BOT_SETTINGS_INVALID"),
        (json!({"commands":["help"]}), "BOT_SETTINGS_INVALID"),
        (json!({"model":"a".repeat(121)}), "BOT_SETTINGS_INVALID"),
        (json!({"model":"gpt luna"}), "BOT_SETTINGS_INVALID"),
        (json!({"model":"gpt\tluna"}), "BOT_SETTINGS_INVALID"),
        (json!({"model":"\"gpt\""}), "BOT_SETTINGS_INVALID"),
        (json!({"model":"gpt\\luna"}), "BOT_SETTINGS_INVALID"),
        (json!({"model":"модель"}), "BOT_SETTINGS_INVALID"),
        (json!({"model":42}), "BOT_SETTINGS_INVALID"),
        (json!({"model":null}), "BOT_SETTINGS_INVALID"),
        (json!({"model":["gpt"]}), "BOT_SETTINGS_INVALID"),
        (json!({"reasoning":"default"}), "BOT_SETTINGS_INVALID"),
        (json!({"reasoning":"HIGH"}), "BOT_SETTINGS_INVALID"),
        (json!({"reasoning":"xhigh"}), "BOT_SETTINGS_INVALID"),
        (json!({"reasoning":5}), "BOT_SETTINGS_INVALID"),
        (
            json!({"model":"openai-codex/gpt-6-luna","reasoning":"max"}),
            "BOT_SETTINGS_INVALID",
        ),
        (json!({"model":"a","revision":0}), "BOT_SETTINGS_CONFLICT"),
        (json!({"model":"a","revision":"1"}), "BOT_SETTINGS_CONFLICT"),
    ] {
        assert_eq!(
            f.b.request(owner_call(&bt, json!(next), fields.clone()))
                .unwrap_err(),
            expected,
            "patch {fields}"
        );
        assert_eq!(
            f.b.db, pending,
            "rejected patch changed the database: {fields}"
        );
    }
    // The refused attempts left the update usable: a valid command applies exactly once.
    let dto =
        f.b.request(owner_call(
            &bt,
            json!(next),
            json!({"reasoning":"high","revision":1}),
        ))
        .unwrap();
    assert_eq!(dto["model"], "openai-codex/gpt-6-luna");
    assert_eq!(dto["reasoning"], "high");
    assert_eq!(dto["revision"], 2);
    assert_eq!(
        f.b.request(owner_call(&bt, json!(next), json!({"reasoning":"low"})))
            .unwrap_err(),
        "BOT_SETTINGS_CONFLICT"
    );
    assert_eq!(f.b.db["bots"][0]["settings"]["reasoning"], "high");
    drop(f.b);
    std::fs::remove_dir_all(f.path.parent().unwrap()).unwrap();
}

#[test]
fn settings_and_the_consumed_marker_survive_reopen() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let path = f.path.clone();
    let owner_token = f.owner_token.clone();
    f.b.request(owner_call(
        &bt,
        json!(f.owner_update),
        json!({"model":"openai-codex/gpt-6-luna","reasoning":"medium"}),
    ))
    .unwrap();
    // The update DTO never exposes the internal one-shot marker.
    let updates =
        f.b.request(json!({"op":"bot_get_updates","bot_token":bt}))
            .unwrap();
    assert!(!updates.to_string().contains(OWNER_APPLIED));
    assert!(arr(&updates["updates"])
        .iter()
        .all(|u| u.get(OWNER_APPLIED).is_none()));
    drop(f.b);
    let mut reopened = Backend::open(path.clone()).unwrap();
    assert_eq!(
        reopened.db["bots"][0]["settings"],
        json!({"model":"openai-codex/gpt-6-luna","reasoning":"medium","revision":1})
    );
    let before = reopened.db.clone();
    assert_eq!(
        reopened
            .request(owner_call(
                &bt,
                json!(f.owner_update),
                json!({"model":"replayed"})
            ))
            .unwrap_err(),
        "BOT_SETTINGS_CONFLICT",
        "a consumed update must stay consumed after a restart"
    );
    assert_eq!(reopened.db, before);
    let dto = reopened
        .request(json!({"op":"bot_get_model_settings","token":owner_token,"bot":f.bot["bot"]["id"].clone()}))
        .unwrap();
    assert_eq!(dto["model"], "openai-codex/gpt-6-luna");
    assert_eq!(dto["reasoning"], "medium");
    drop(reopened);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn http_statuses_for_owner_member_foreign_replay_and_invalid_values() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let owner_token = f.owner_token.clone();
    let ghost_token = f.foreign_bot_token.clone();
    let path = f.path.clone();
    let owner_update = f.owner_update;
    let guest_update = f.guest_update;
    // A second owner-authored update stays pending for the validation status checks.
    let pending_owner = push_message(&mut f.b, &f.channel, &f.owner, "/ask later");
    let backend = f.b;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api", listener.local_addr().unwrap());
    let server =
        tokio::spawn(async move { axum::serve(listener, api_router(backend)).await.unwrap() });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let call = |update_id: u64, fields: Value| {
        let mut body = json!({"op":"bot_owner_update_settings","update_id":update_id});
        for (key, value) in fields.as_object().unwrap() {
            body[key] = value.clone();
        }
        body
    };
    let response = client
        .post(&url)
        .bearer_auth(&bt)
        .json(&call(
            owner_update,
            json!({"model":"openai-codex/gpt-6-luna","reasoning":"high"}),
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let data = response.json::<Value>().await.unwrap()["data"].clone();
    assert_eq!(sorted_keys(&data), dto_keys());
    assert_eq!(data["model"], "openai-codex/gpt-6-luna");
    assert_eq!(data["reasoning"], "high");
    assert_eq!(data["revision"], 1);
    // Replay of the consumed update is refused.
    let response = client
        .post(&url)
        .bearer_auth(&bt)
        .json(&call(owner_update, json!({"model":"replayed"})))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    assert_eq!(
        response.json::<Value>().await.unwrap()["error"],
        "BOT_SETTINGS_CONFLICT"
    );
    // An ordinary member's update is a 403.
    let response = client
        .post(&url)
        .bearer_auth(&bt)
        .json(&call(guest_update, json!({"model":"member-model"})))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 403);
    assert_eq!(
        response.json::<Value>().await.unwrap()["error"],
        "BOT_SETTINGS_FORBIDDEN"
    );
    // A foreign bot's token is a 403 for someone else's update.
    let response = client
        .post(&url)
        .bearer_auth(&ghost_token)
        .json(&call(owner_update, json!({"model":"foreign"})))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 403);
    // Invalid values on a still-pending owner update are 400 and change nothing.
    for (body, error) in [
        (
            call(pending_owner, json!({"model":"bad model"})),
            "BOT_SETTINGS_INVALID",
        ),
        (
            call(pending_owner, json!({"reasoning":"xhigh"})),
            "BOT_SETTINGS_INVALID",
        ),
        (
            call(pending_owner, json!({"provider":"openai"})),
            "BOT_SETTINGS_INVALID",
        ),
        (
            json!({"op":"bot_owner_update_settings","model":"x"}),
            "BOT_SETTINGS_INVALID",
        ),
    ] {
        let response = client
            .post(&url)
            .bearer_auth(&bt)
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 400, "{body}");
        assert_eq!(response.json::<Value>().await.unwrap()["error"], error);
    }
    // The refused attempts did not consume the pending update.
    let response = client
        .post(&url)
        .bearer_auth(&bt)
        .json(&call(
            pending_owner,
            json!({"reasoning":"low","revision":1}),
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        response.json::<Value>().await.unwrap()["data"]["revision"],
        2
    );
    // The human cookie path cannot reach this operation at all.
    let response = client
        .post(&url)
        .header("cookie", format!("mines_session={owner_token}"))
        .json(&call(pending_owner, json!({"model":"from-cookie"})))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
    server.abort();
    let _ = server.await;
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
