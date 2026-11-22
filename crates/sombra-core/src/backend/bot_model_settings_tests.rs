use super::*;
fn fixture() -> (Backend, PathBuf, String, Value) {
    let path = std::env::temp_dir().join(id()).join("db.json");
    let mut b = Backend::open(path.clone()).unwrap();
    let owner = b.db["users"][0].clone();
    let token = b.token(&owner, "model-settings", false).unwrap();
    let group = b.db["groups"][0]["id"].clone();
    let bot = b
        .request(json!({"op":"create_bot","token":token,"group":group,"name":"Helper","username":"helper"}))
        .unwrap();
    (b, path, token, bot)
}
fn patch(token: &str, bid: &Value, fields: &Value) -> Value {
    let mut v = json!({"op":"bot_update_settings","token":token,"bot":bid});
    for (key, value) in fields.as_object().unwrap() {
        v[key] = value.clone();
    }
    v
}
fn read(token: &str, bid: &Value) -> Value {
    json!({"op":"bot_get_model_settings","token":token,"bot":bid})
}
/// Only these keys may ever leave the server for this feature.
fn safe_dto_keys() -> Vec<String> {
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
    .collect()
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
#[tokio::test]
async fn http_owner_cookie_only_and_no_bot_or_forged_identity_access() {
    let (mut b, path, owner_token, bot) = fixture();
    let bid = bot["bot"]["id"].clone();
    let bot_token = bot["token"].clone();
    let owner = bot["bot"]["owner"].clone();
    let guest = json!({"id":id(),"name":"Other Admin","active":true});
    b.db["users"].as_array_mut().unwrap().push(guest.clone());
    let guest_token = b.token(&guest, "guest", false).unwrap();
    b.save().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, api_router(b)).await.unwrap() });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let owner_cookie = format!("mines_session={owner_token}");
    let guest_cookie = format!("mines_session={guest_token}");
    let update = json!({"op":"bot_update_settings","bot":bid,"model":"openai-codex/gpt-6-luna","reasoning":"high"});
    let response = client
        .post(&url)
        .header("cookie", &owner_cookie)
        .json(&update)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200, "owner cookie must be enough");
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body: Value = response.json().await.unwrap();
    let data = body["data"].clone();
    assert_eq!(data["bot"], bid);
    assert_eq!(data["model"], "openai-codex/gpt-6-luna");
    assert_eq!(data["reasoning"], "high");
    assert_eq!(data["revision"], 1);
    assert_eq!(data["modelDefault"], false);
    assert_eq!(sorted_keys(&data), safe_dto_keys());
    assert!(!data.to_string().contains("token"));
    let response = client
        .post(&url)
        .header("cookie", &owner_cookie)
        .json(&read(&owner_token, &bid))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.json::<Value>().await.unwrap()["data"], data);
    let mut forged = update.clone();
    forged["token"] = json!(owner_token);
    forged["requester_id"] = owner.clone();
    forged["owner"] = owner.clone();
    let response = client.post(&url).json(&forged).send().await.unwrap();
    assert_eq!(
        response.status(),
        401,
        "a body token must not replace the human cookie session"
    );
    let mut spoofed = update.clone();
    spoofed["model"] = json!("guest-chosen-model");
    spoofed["token"] = json!(guest_token);
    spoofed["requester_id"] = owner.clone();
    spoofed["owner"] = owner.clone();
    for request in [spoofed, read(&guest_token, &bid)] {
        let response = client
            .post(&url)
            .header("cookie", &guest_cookie)
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            403,
            "a normal member must not reach another owner's bot"
        );
        assert_eq!(
            response.json::<Value>().await.unwrap()["error"],
            "BOT_SETTINGS_FORBIDDEN"
        );
        let response = client
            .post(&url)
            .header("cookie", &guest_cookie)
            .json(&json!({"op":request["op"],"bot":id()}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 403, "unknown bot ids stay forbidden");
    }
    for request in [update.clone(), read(&owner_token, &bid)] {
        let mut request = request;
        request["token"] = json!(owner_token);
        request["requester_id"] = owner.clone();
        let response = client
            .post(&url)
            .bearer_auth(bot_token.as_str().unwrap())
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            401,
            "a bot token must never read or change owner settings"
        );
    }
    server.abort();
    let _ = server.await;
    let reopened = Backend::open(path.clone()).unwrap();
    assert_eq!(
        reopened.db["bots"][0]["settings"]["model"], "openai-codex/gpt-6-luna",
        "refused writes must not overwrite the saved value"
    );
    drop(reopened);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn strict_validation_is_atomic_and_preserves_owner_policy_commands_installs() {
    let (mut b, path, token, bot) = fixture();
    let bid = bot["bot"]["id"].clone();
    let owner_id = b.db["users"][0]["id"].clone();
    b.request(json!({"op":"bot_set_commands","token":token,"bot":bid,"commands":["help","ask","model"]}))
        .unwrap();
    b.request(json!({"op":"set_bot_tool_users","token":token,"bot":bid,"revision":0,"users":[owner_id]})).unwrap();
    let before = b.db.clone();
    for bad in [
        json!({}),
        json!({"unknown":"x"}),
        json!({"provider":"openai"}),
        json!({"model":"a".repeat(121)}),
        json!({"model":"gpt luna"}),
        json!({"model":"gpt\tluna"}),
        json!({"model":"\"gpt\""}),
        json!({"model":"gpt\\luna"}),
        json!({"model":"модель"}),
        json!({"model":42}),
        json!({"model":null}),
        json!({"model":["gpt"]}),
        json!({"reasoning":"default"}),
        json!({"reasoning":"HIGH"}),
        json!({"reasoning":"xhigh"}),
        json!({"reasoning":5}),
        json!({"reasoning":null}),
        json!({"model":"openai-codex/gpt-6-luna","reasoning":"max"}),
        json!({"owner":"forged"}),
        json!({"commands":["help"]}),
        json!({"trust":true}),
    ] {
        assert_eq!(
            b.request(patch(&token, &bid, &bad)).unwrap_err(),
            "BOT_SETTINGS_INVALID",
            "patch {bad}"
        );
        assert_eq!(b.db, before, "rejected patch must not change anything: {bad}");
    }
    for reasoning in ["low", "medium", "high", ""] {
        let saved =
            b.request(patch(&token, &bid, &json!({"model":"openai-codex/gpt-6-luna","reasoning":reasoning}))).unwrap();
        assert_eq!(saved["model"], "openai-codex/gpt-6-luna");
        assert_eq!(saved["reasoning"], reasoning);
    }
    let saved = b.request(patch(&token, &bid, &json!({"model":"a".repeat(120)}))).unwrap();
    assert_eq!(saved["model"], "a".repeat(120));
    let saved = b.request(patch(&token, &bid, &json!({"model":"anthropic:claude-sonnet@2+v1.1"}))).unwrap();
    assert_eq!(saved["model"], "anthropic:claude-sonnet@2+v1.1");
    let cleared = b.request(patch(&token, &bid, &json!({"model":"","reasoning":""}))).unwrap();
    assert_eq!(cleared["modelDefault"], true);
    assert_eq!(cleared["reasoningDefault"], true);
    assert_eq!(b.db["bots"][0]["settings"], json!({"model":"","reasoning":"","revision":cleared["revision"]}));
    let after = b.db.clone();
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
        assert_eq!(after["bots"][0][key], before["bots"][0][key], "{key} unchanged");
    }
    assert_eq!(
        after["bots"][0].as_object().unwrap().len(),
        before["bots"][0].as_object().unwrap().len() + 1,
        "only the new settings object may be added"
    );
    assert_eq!(after["users"], before["users"]);
    assert_eq!(after["groups"], before["groups"]);
    assert_eq!(after["sessions"], before["sessions"]);
    assert_eq!(after["bot_updates"], before["bot_updates"]);
    assert_eq!(b.request(read(&token, &bid)).unwrap()["commands"], Value::Null);
    drop(b);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn defaults_for_old_bots_state_projection_and_reopen_persistence() {
    let (mut b, path, token, bot) = fixture();
    let bid = bot["bot"]["id"].clone();
    assert!(b.db["bots"][0]["settings"].is_null());
    assert_eq!(
        b.request(read(&token, &bid)).unwrap(),
        json!({"bot":bid,"model":"","reasoning":"","revision":0,"modelDefault":true,"reasoningDefault":true})
    );
    let state = b.request(json!({"op":"state","token":token})).unwrap();
    let row = arr(&state["bots"])
        .into_iter()
        .find(|row| row["id"] == bid)
        .unwrap();
    assert_eq!(
        row["modelSettings"],
        json!({"model":"","reasoning":"","revision":0,"modelDefault":true,"reasoningDefault":true})
    );
    assert!(row.get("settings").is_none());
    assert!(row.get("token_hash").is_none());
    assert!(!state.to_string().contains("token_hash"));
    assert!(!state.to_string().contains("\"settings\""));
    // An old record written before this field existed keeps reading as the plugin default.
    b.db["bots"][0].as_object_mut().unwrap().remove("settings");
    b.save().unwrap();
    drop(b);
    let mut b = Backend::open(path.clone()).unwrap();
    assert_eq!(b.request(read(&token, &bid)).unwrap()["model"], "");
    b.request(patch(&token, &bid, &json!({"model":"openai-codex/gpt-6-luna","reasoning":"medium"})))
        .unwrap();
    drop(b);
    let mut reopened = Backend::open(path.clone()).unwrap();
    assert_eq!(
        reopened.db["bots"][0]["settings"],
        json!({"model":"openai-codex/gpt-6-luna","reasoning":"medium","revision":1})
    );
    let dto = reopened.request(read(&token, &bid)).unwrap();
    assert_eq!(dto["model"], "openai-codex/gpt-6-luna");
    assert_eq!(dto["reasoning"], "medium");
    assert_eq!(dto["revision"], 1);
    // Provider material that a future version might store never reaches a client DTO.
    reopened.db["bots"][0]["settings"]["provider_secret"] = json!("sk-do-not-leak");
    reopened.db["bots"][0]["settings"]["base_url"] = json!("https://internal.invalid");
    reopened.save().unwrap();
    let dto = reopened.request(read(&token, &bid)).unwrap();
    assert!(!dto.to_string().contains("sk-do-not-leak"));
    assert!(!dto.to_string().contains("internal.invalid"));
    assert_eq!(sorted_keys(&dto), safe_dto_keys());
    let state = reopened.request(json!({"op":"state","token":token})).unwrap();
    assert!(!state.to_string().contains("sk-do-not-leak"));
    assert!(!state.to_string().contains("internal.invalid"));
    assert!(!state.to_string().contains("base_url"));
    drop(reopened);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn cas_revision_is_independent_of_profile_settings_and_failures_roll_back() {
    let (mut b, path, token, bot) = fixture();
    let bid = bot["bot"]["id"].clone();
    assert_eq!(
        b.request(patch(&token, &bid, &json!({"model":"a","revision":1}))).unwrap_err(),
        "BOT_SETTINGS_CONFLICT"
    );
    assert_eq!(
        b.request(patch(&token, &bid, &json!({"model":"a","revision":"0"}))).unwrap_err(),
        "BOT_SETTINGS_CONFLICT"
    );
    assert_eq!(
        b.request(patch(&token, &bid, &json!({"model":"openai-codex/gpt-6-luna","revision":0}))).unwrap()["revision"],
        1
    );
    assert_eq!(
        b.request(patch(&token, &bid, &json!({"model":"openai-codex/gpt-6-luna","revision":0}))).unwrap_err(),
        "BOT_SETTINGS_CONFLICT"
    );
    assert_eq!(b.request(patch(&token, &bid, &json!({"model":"gpt-6-luna"}))).unwrap()["revision"], 2);
    // Profile settings keep their own revision and publish the model through bot_public.
    let profile = b.request(json!({"op":"get_bot_settings","token":token,"bot":bid})).unwrap();
    assert_eq!(profile["revision"], 0);
    assert_eq!(profile["bot"]["modelSettings"]["model"], "gpt-6-luna");
    assert_eq!(profile["bot"]["modelSettings"]["revision"], 2);
    assert!(profile["bot"].get("settings").is_none());
    assert!(!profile.to_string().contains("token_hash"));
    b.request(json!({"op":"update_bot_settings","token":token,"bot":bid,"revision":0,"profile":{"bio":"Owner text"}}))
        .unwrap();
    assert_eq!(b.request(read(&token, &bid)).unwrap()["revision"], 2);
    // A failed save leaves neither the new value nor the bumped revision behind.
    let snapshot = b.db.clone();
    let saved_path = b.path.clone();
    b.path = path.parent().unwrap().to_path_buf();
    assert_eq!(
        b.request(patch(&token, &bid, &json!({"model":"claude-next","revision":2}))).unwrap_err(),
        "STORAGE_UNAVAILABLE"
    );
    assert_eq!(b.db, snapshot);
    b.path = saved_path;
    let _ = std::fs::remove_file(path.parent().unwrap().with_extension("tmp"));
    // The service token still routes to bot_worker operations and reads its own settings.
    let bt = b.request(json!({"op":"bot_rotate_token","token":token,"bot":bid})).unwrap()["token"].clone();
    assert_eq!(
        b.request(json!({"op":"bot_get_settings","bot_token":bt})).unwrap_err(),
        "BOT_SOURCE_UNAVAILABLE"
    );
    assert_eq!(
        b.request(json!({"op":"bot_get_model_settings","bot_token":bt})).unwrap_err(),
        "AUTH_REQUIRED"
    );
    assert_eq!(
        b.request(json!({"op":"bot_update_settings","bot_token":bt,"bot":bid,"model":"x"})).unwrap_err(),
        "AUTH_REQUIRED"
    );
    let me = b.request(json!({"op":"bot_get_me","bot_token":bt})).unwrap();
    assert_eq!(me["bot"]["modelSettings"]["model"], "gpt-6-luna");
    assert!(!me.to_string().contains("token_hash"));
    // Legacy, disabled and foreign-owned bots keep the established refusals.
    b.db["bots"][0]["legacy"] = json!(true);
    assert_eq!(b.request(read(&token, &bid)).unwrap_err(), "BOT_SETTINGS_FORBIDDEN");
    assert_eq!(
        b.request(patch(&token, &bid, &json!({"model":"legacy"}))).unwrap_err(),
        "BOT_SETTINGS_FORBIDDEN"
    );
    b.db["bots"][0]["legacy"] = json!(false);
    b.db["bots"][0]["enabled"] = json!(false);
    assert_eq!(b.request(read(&token, &bid)).unwrap_err(), "BOT_SETTINGS_FORBIDDEN");
    b.db["bots"][0]["enabled"] = json!(true);
    let guest = json!({"id":id(),"name":"New Owner","active":true});
    b.db["users"].as_array_mut().unwrap().push(guest.clone());
    b.db["bots"][0]["owner"] = guest["id"].clone();
    assert_eq!(b.request(read(&token, &bid)).unwrap_err(), "BOT_SETTINGS_FORBIDDEN");
    let guest_token = b.token(&guest, "new-owner", false).unwrap();
    assert_eq!(b.request(read(&guest_token, &bid)).unwrap()["model"], "gpt-6-luna");
    drop(b);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
