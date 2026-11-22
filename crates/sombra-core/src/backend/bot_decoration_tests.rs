use super::*;

struct Fixture {
    b: Backend,
    path: PathBuf,
    owner: Value,
    owner_token: String,
    channel: Value,
    foreign_group: Value,
    bot_token: String,
    foreign_bot_token: String,
    guest: Value,
    owner_update: u64,
    guest_update: u64,
}

fn avatar_doc() -> Value {
    json!({"v":1,"target":"avatar","seed":19,"layers":[{"effect":"holy/divine-shield","palette":"ember","anchor":"ring","intensity":0.9}]})
}

fn cover_scene() -> Value {
    json!({"v":1,"target":"cover","mode":"scene","loop":true,"seed":11,"layers":[{"effect":"weather/aurora","palette":"aurora","anchor":"fill","intensity":0.75},{"effect":"sombra/runner","palette":"ice","anchor":"runner","intensity":0.9}]})
}

/// One owner-authored update and one ordinary-member update for the same modern bot, plus a
/// second bot in another group that never receives those update ids.
fn fixture() -> Fixture {
    let path = std::env::temp_dir().join(id()).join("db.json");
    let mut b = Backend::open(path.clone()).unwrap();
    let owner = b.db["users"][0].clone();
    let owner_token = b.token(&owner, "bot-decorations", false).unwrap();
    let group = b.db["groups"][0].clone();
    let channel = group["channels"][0]["id"].clone();
    let bot = b
        .request(json!({"op":"create_bot","token":owner_token,"group":group["id"],"name":"Decorator","username":"decorator"}))
        .unwrap();
    let bot_token = bot["token"].as_str().unwrap().to_owned();
    let guest = b
        .request(json!({"op":"register","name":"Member","email":format!("bot-decorations-{}@test.local", id()),"password":"strong-password"}))
        .unwrap()["user"]
        .clone();
    b.db["groups"][0]["members"]
        .as_array_mut()
        .unwrap()
        .push(guest["id"].clone());
    b.save().unwrap();
    let foreign_group = b
        .request(json!({"op":"create_group","token":owner_token,"name":"Elsewhere"}))
        .unwrap();
    let foreign = b
        .request(json!({"op":"create_bot","token":owner_token,"group":foreign_group["id"],"name":"Other bot","username":"otherdecorator"}))
        .unwrap();
    let foreign_bot_token = foreign["token"].as_str().unwrap().to_owned();
    let (_, owner_update) = push_message(&mut b, &channel, &owner, "/ask frame please");
    let (_, guest_update) = push_message(&mut b, &channel, &guest, "/ask frame for member");
    Fixture {
        b,
        path,
        owner,
        owner_token,
        channel,
        foreign_group,
        bot_token,
        foreign_bot_token,
        guest,
        owner_update,
        guest_update,
    }
}

/// A real queued update is required: the server never trusts an id without a source. The
/// read-state migration runs here so later database snapshots stay comparable.
fn push_message(b: &mut Backend, channel: &Value, user: &Value, text: &str) -> (String, u64) {
    let message_id = id();
    let message = json!({"id":message_id.clone(),"channel":channel,"user":user["id"],"text":text,"time":now()});
    b.db["messages"]
        .as_array_mut()
        .unwrap()
        .push(message.clone());
    b.enqueue_bots(&message).unwrap();
    b.normalize_read_sequences().unwrap();
    b.save().unwrap();
    let update_id = arr(&b.db["bot_updates"])
        .into_iter()
        .filter(|u| u["message"]["id"] == json!(message_id.as_str()))
        .filter_map(|u| u["update_id"].as_u64())
        .max()
        .unwrap();
    (message_id, update_id)
}

fn call(bot_token: &str, update_id: u64, target: &str, decoration: &Value) -> Value {
    json!({"op":OP,"bot_token":bot_token,"update_id":update_id,"target":target,"decoration":decoration})
}

fn update_row(b: &Backend, update_id: u64) -> Value {
    arr(&b.db["bot_updates"])
        .into_iter()
        .find(|u| u["update_id"] == json!(update_id))
        .unwrap()
}

fn user_index(b: &Backend, uid: &Value) -> usize {
    b.db["users"]
        .as_array()
        .unwrap()
        .iter()
        .position(|u| u["id"] == *uid)
        .unwrap()
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

#[test]
fn owner_invocation_applies_once_to_sender_and_leaves_other_records_alone() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let owner_id = f.owner["id"].clone();
    let before = f.b.db.clone();
    let result =
        f.b.request(call(&bt, f.owner_update, "avatar", &avatar_doc()))
            .unwrap();
    assert_eq!(
        result,
        json!({"user":{"id":owner_id,"decorations":{"avatar":avatar_doc()}}}),
        "the response is the minimal decoration projection"
    );
    assert_eq!(sorted_keys(&result), vec!["user"]);
    assert_eq!(
        sorted_keys(&result["user"]),
        vec!["decorations", "id"],
        "no identity, hash, salt or email in the DTO"
    );
    for secret in ["hash", "salt", "email", "password", "token"] {
        assert!(!result.to_string().contains(secret), "{secret} leaked");
    }
    // The owner's document is readable through the existing human projections.
    let me =
        f.b.request(json!({"op":"me","token":f.owner_token}))
            .unwrap();
    assert_eq!(me["user"]["decorations"]["avatar"], avatar_doc());
    let state =
        f.b.request(json!({"op":"state","token":f.owner_token}))
            .unwrap();
    let rows = arr(&state["users"]);
    let owner_row = rows.iter().find(|u| u["id"] == owner_id).unwrap();
    assert_eq!(owner_row["decorations"]["avatar"], avatar_doc());
    let guest_row = rows.iter().find(|u| u["id"] == f.guest["id"]).unwrap();
    assert!(guest_row.get("decorations").is_none());
    // The marker rides on the owner's source update only.
    assert_eq!(update_row(&f.b, f.owner_update)[APPLIED], true);
    assert!(update_row(&f.b, f.guest_update).get(APPLIED).is_none());
    let after = f.b.db.clone();
    let oi = user_index(&f.b, &owner_id);
    let gi = user_index(&f.b, &f.guest["id"]);
    for key in [
        "bots", "groups", "dialogs", "messages", "sessions", "friends", "stickers",
    ] {
        assert_eq!(after[key], before[key], "{key} must not change");
    }
    for (i, user) in arr(&before["users"]).iter().enumerate() {
        if i != oi {
            assert_eq!(after["users"][i], *user, "other user {i} must not change");
        }
    }
    for key in [
        "id",
        "name",
        "email",
        "salt",
        "hash",
        "bio",
        "avatar",
        "profile_cover",
        "created_at",
        "version",
        "bot",
        "active",
        "username",
    ] {
        assert_eq!(
            after["users"][oi][key], before["users"][oi][key],
            "{key} must not change"
        );
    }
    assert_eq!(
        after["users"][oi].as_object().unwrap().len(),
        before["users"][oi].as_object().unwrap().len() + 1,
        "only the decorations object may be added"
    );
    assert!(after["users"][gi].get("decorations").is_none());
    // Replay before ack is a conflict and changes nothing.
    let consumed = f.b.db.clone();
    assert_eq!(
        f.b.request(call(&bt, f.owner_update, "cover", &cover_scene()))
            .unwrap_err(),
        "BOT_DECORATION_CONFLICT"
    );
    assert_eq!(f.b.db, consumed);
    // Acking closes the update for decorations as well.
    f.b.request(json!({"op":"bot_ack","bot_token":bt,"update_id":f.owner_update}))
        .unwrap();
    let acked = f.b.db.clone();
    assert_eq!(
        f.b.request(call(&bt, f.owner_update, "avatar", &avatar_doc()))
            .unwrap_err(),
        "BOT_DECORATION_CONFLICT"
    );
    assert_eq!(f.b.db, acked);
    drop(f.b);
    std::fs::remove_dir_all(f.path.parent().unwrap()).unwrap();
}

#[test]
fn invalid_documents_and_requests_change_nothing_and_do_not_consume_the_update() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let (_, next) = push_message(&mut f.b, &f.channel, &f.owner, "/ask decorate me");
    let pending = f.b.db.clone();
    let four_layers = json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield"},{"effect":"holy/divine-shield"},{"effect":"holy/divine-shield"},{"effect":"holy/divine-shield"}]});
    let oversized = json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield"}],"description":"A".repeat(5000)});
    let bad_documents = vec![
        // Unknown effect, anchor and palette.
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"fire/fire-ring"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","anchor":"center"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","palette":"slime"}]}),
        ),
        // Layer count and per-target size cap.
        ("avatar", four_layers),
        ("avatar", oversized),
        // Version, target mismatch and unknown document/layer keys.
        (
            "avatar",
            json!({"v":2,"target":"avatar","layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"cover","layers":[{"effect":"holy/divine-shield"}]}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield"}],"url":"https://example.invalid/a.js"}),
        ),
        (
            "avatar",
            json!({"v":1,"target":"avatar","layers":[{"effect":"holy/divine-shield","text":"hi"}]}),
        ),
        // Not a document at all.
        ("avatar", json!("holy/divine-shield")),
        ("avatar", json!(5)),
    ];
    for (target, document) in bad_documents {
        assert_eq!(
            f.b.request(call(&bt, next, target, &document)).unwrap_err(),
            INVALID,
            "document {document}"
        );
        assert_eq!(
            f.b.db, pending,
            "a rejected document must change nothing: {document}"
        );
    }
    // The request itself is strict: target and decoration are mandatory and no field may name a
    // different person or bot.
    for request in [
        json!({"op":OP,"bot_token":bt,"update_id":next,"decoration":avatar_doc()}),
        json!({"op":OP,"bot_token":bt,"update_id":next,"target":"chat","decoration":avatar_doc()}),
        json!({"op":OP,"bot_token":bt,"update_id":next,"target":"avatar"}),
        json!({"op":OP,"bot_token":bt,"update_id":next,"target":"avatar","decoration":avatar_doc(),"user":f.owner["id"]}),
        json!({"op":OP,"bot_token":bt,"update_id":next,"target":"avatar","decoration":avatar_doc(),"requester":f.owner["id"]}),
        json!({"op":OP,"bot_token":bt,"update_id":next,"target":"avatar","decoration":avatar_doc(),"id":f.owner["id"]}),
        json!({"op":OP,"bot_token":bt,"update_id":next,"target":"avatar","decoration":avatar_doc(),"owner":f.owner["id"]}),
        json!({"op":OP,"bot_token":bt,"update_id":next,"target":"avatar","decoration":avatar_doc(),"theme":"dark"}),
    ] {
        assert_eq!(
            f.b.request(request.clone()).unwrap_err(),
            INVALID,
            "request {request}"
        );
        assert_eq!(f.b.db, pending, "request {request}");
    }
    // Missing, string, null and float update ids are invalid before anything is looked up.
    for update_id in [Value::Null, json!("1"), json!(1.0), json!(-1), json!(true)] {
        let mut request = call(&bt, next, "avatar", &avatar_doc());
        request["update_id"] = update_id.clone();
        assert_eq!(
            f.b.request(request).unwrap_err(),
            INVALID,
            "update_id {update_id}"
        );
        assert_eq!(f.b.db, pending);
    }
    let mut missing = call(&bt, next, "avatar", &avatar_doc());
    missing.as_object_mut().unwrap().remove("update_id");
    assert_eq!(f.b.request(missing).unwrap_err(), INVALID);
    assert_eq!(f.b.db, pending);
    // The refused attempts left the update usable: a valid document applies exactly once.
    let applied =
        f.b.request(call(&bt, next, "avatar", &avatar_doc()))
            .unwrap();
    assert_eq!(applied["user"]["decorations"]["avatar"], avatar_doc());
    assert_eq!(update_row(&f.b, next)[APPLIED], true);
    assert_eq!(
        f.b.request(call(&bt, next, "avatar", &avatar_doc()))
            .unwrap_err(),
        "BOT_DECORATION_CONFLICT"
    );
    drop(f.b);
    std::fs::remove_dir_all(f.path.parent().unwrap()).unwrap();
}

#[test]
fn foreign_unknown_cancelled_human_deleted_and_legacy_sources_are_refused() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let owner_token = f.owner_token.clone();
    let before = f.b.db.clone();
    // Another bot's token can never address this update.
    assert_eq!(
        f.b.request(call(
            &f.foreign_bot_token,
            f.owner_update,
            "avatar",
            &avatar_doc()
        ))
        .unwrap_err(),
        "BOT_DECORATION_FORBIDDEN"
    );
    assert_eq!(f.b.db, before);
    // Unknown update ids are forbidden exactly like another bot's update.
    assert_eq!(
        f.b.request(call(&bt, f.owner_update + 1000, "avatar", &avatar_doc()))
            .unwrap_err(),
        "BOT_DECORATION_FORBIDDEN"
    );
    assert_eq!(f.b.db, before);
    // A human cookie without a bot Bearer token is not a credential for this path.
    let mut human = call(&bt, f.owner_update, "avatar", &avatar_doc());
    human.as_object_mut().unwrap().remove("bot_token");
    human["token"] = json!(owner_token);
    assert_eq!(f.b.request(human).unwrap_err(), "AUTH_REQUIRED");
    assert_eq!(f.b.db, before);
    // Editing the source message cancels consent even though the sender is still the owner.
    let (message_id, cancelled_update) =
        push_message(&mut f.b, &f.channel, &f.owner, "/ask decorate");
    f.b.request(
        json!({"op":"update_message","token":owner_token,"message":message_id,"text":"changed"}),
    )
    .unwrap();
    let cancelled = f.b.db.clone();
    assert_eq!(
        f.b.request(call(&bt, cancelled_update, "avatar", &avatar_doc()))
            .unwrap_err(),
        "BOT_SOURCE_UNAVAILABLE"
    );
    assert_eq!(f.b.db, cancelled);
    assert!(update_row(&f.b, cancelled_update).get(APPLIED).is_none());
    // Losing membership in the source channel also revokes authority.
    f.b.db["groups"][0]["members"]
        .as_array_mut()
        .unwrap()
        .retain(|u| u != &f.guest["id"]);
    f.b.save().unwrap();
    let revoked = f.b.db.clone();
    assert_eq!(
        f.b.request(call(&bt, f.guest_update, "cover", &cover_scene()))
            .unwrap_err(),
        "BOT_SOURCE_UNAVAILABLE"
    );
    assert_eq!(f.b.db, revoked);
    // A deleted bot's token no longer authenticates at all.
    let gone = f
        .b
        .request(json!({"op":"create_bot","token":owner_token,"group":f.foreign_group["id"],"name":"Gone","username":"gonebot"}))
        .unwrap();
    let gone_token = gone["token"].as_str().unwrap().to_owned();
    f.b.request(json!({"op":"delete_bot","token":owner_token,"bot":gone["bot"]["id"]}))
        .unwrap();
    let deleted = f.b.db.clone();
    assert_eq!(
        f.b.request(call(&gone_token, 1, "avatar", &avatar_doc()))
            .unwrap_err(),
        "AUTH_REQUIRED"
    );
    assert_eq!(f.b.db, deleted);
    // Legacy room tokens are explicitly out of scope for scoped bot operations.
    let legacy = f
        .b
        .request(json!({"op":"create_bot","token":owner_token,"channel":f.channel,"name":"Legacy"}))
        .unwrap();
    let legacy_token = legacy["token"].as_str().unwrap().to_owned();
    let legacy_before = f.b.db.clone();
    assert_eq!(
        f.b.request(call(&legacy_token, 1, "avatar", &avatar_doc()))
            .unwrap_err(),
        "Legacy tokens are room-only"
    );
    assert_eq!(f.b.db, legacy_before);
    drop(f.b);
    std::fs::remove_dir_all(f.path.parent().unwrap()).unwrap();
}

#[test]
fn null_removes_only_its_target_and_repeats_are_idempotent_by_final_state() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let owner_id = f.owner["id"].clone();
    let oi = user_index(&f.b, &owner_id);
    let first =
        f.b.request(call(&bt, f.owner_update, "avatar", &avatar_doc()))
            .unwrap();
    assert_eq!(first["user"]["decorations"]["avatar"], avatar_doc());
    let (_, cover_update) = push_message(&mut f.b, &f.channel, &f.owner, "/ask cover");
    let second =
        f.b.request(call(&bt, cover_update, "cover", &cover_scene()))
            .unwrap();
    assert_eq!(second["user"]["decorations"]["avatar"], avatar_doc());
    assert_eq!(second["user"]["decorations"]["cover"], cover_scene());
    // Removing the avatar leaves the cover untouched.
    let (_, remove_avatar) = push_message(&mut f.b, &f.channel, &f.owner, "/ask remove avatar");
    let removed =
        f.b.request(call(&bt, remove_avatar, "avatar", &Value::Null))
            .unwrap();
    assert!(removed["user"]["decorations"].get("avatar").is_none());
    assert_eq!(removed["user"]["decorations"]["cover"], cover_scene());
    assert_eq!(
        f.b.db["users"][oi]["decorations"],
        json!({"cover":cover_scene()})
    );
    // A second null for the same target is a no-op in the final state.
    let (_, remove_avatar_again) =
        push_message(&mut f.b, &f.channel, &f.owner, "/ask remove avatar again");
    let removed_again =
        f.b.request(call(&bt, remove_avatar_again, "avatar", &Value::Null))
            .unwrap();
    assert_eq!(removed_again["user"], removed["user"]);
    // Removing the last target drops the whole field, exactly like an account that never had it.
    let (_, remove_cover) = push_message(&mut f.b, &f.channel, &f.owner, "/ask remove cover");
    let last =
        f.b.request(call(&bt, remove_cover, "cover", &Value::Null))
            .unwrap();
    assert_eq!(last["user"]["decorations"], json!({}));
    assert!(f.b.db["users"][oi].get("decorations").is_none());
    let no_decorations = f.b.db["users"][oi].clone();
    let (_, remove_cover_again) =
        push_message(&mut f.b, &f.channel, &f.owner, "/ask remove cover again");
    let last_again =
        f.b.request(call(&bt, remove_cover_again, "cover", &Value::Null))
            .unwrap();
    assert_eq!(last_again["user"]["decorations"], json!({}));
    assert_eq!(f.b.db["users"][oi], no_decorations);
    // The sender's profile is the only one ever touched.
    let gi = user_index(&f.b, &f.guest["id"]);
    assert!(f.b.db["users"][gi].get("decorations").is_none());
    drop(f.b);
    std::fs::remove_dir_all(f.path.parent().unwrap()).unwrap();
}

#[test]
fn failed_write_rolls_back_marker_and_value_and_both_survive_reopen() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let (_, update) = push_message(&mut f.b, &f.channel, &f.owner, "/ask atomic frame");
    let snapshot = f.b.db.clone();
    let saved_path = f.b.path.clone();
    f.b.path = saved_path.parent().unwrap().to_path_buf();
    assert_eq!(
        f.b.request(call(&bt, update, "avatar", &avatar_doc()))
            .unwrap_err(),
        "STORAGE_UNAVAILABLE"
    );
    assert_eq!(
        f.b.db, snapshot,
        "a failed save must roll back both the marker and the decoration"
    );
    assert!(update_row(&f.b, update).get(APPLIED).is_none());
    f.b.path = saved_path.clone();
    let _ = std::fs::remove_file(saved_path.parent().unwrap().with_extension("tmp"));
    // The same update is still usable after the failed write.
    let applied =
        f.b.request(call(&bt, update, "avatar", &avatar_doc()))
            .unwrap();
    assert_eq!(applied["user"]["decorations"]["avatar"], avatar_doc());
    assert_eq!(update_row(&f.b, update)[APPLIED], true);
    let applied_db = f.b.db.clone();
    drop(f.b);
    let mut reopened = Backend::open(saved_path.clone()).unwrap();
    let oi = user_index(&reopened, &f.owner["id"]);
    assert_eq!(
        reopened.db["users"][oi]["decorations"]["avatar"],
        avatar_doc()
    );
    assert_eq!(update_row(&reopened, update)[APPLIED], true);
    let before = reopened.db.clone();
    assert_eq!(
        reopened
            .request(call(&bt, update, "avatar", &avatar_doc()))
            .unwrap_err(),
        "BOT_DECORATION_CONFLICT",
        "a consumed update stays consumed after a restart"
    );
    assert_eq!(reopened.db, before);
    drop(reopened);
    let reopened = Backend::open(saved_path.clone()).unwrap();
    assert_eq!(
        reopened.db["users"][oi]["decorations"]["avatar"],
        avatar_doc()
    );
    assert_eq!(update_row(&reopened, update)[APPLIED], true);
    assert_eq!(
        applied_db["users"][oi]["decorations"]["avatar"],
        avatar_doc()
    );
    drop(reopened);
    std::fs::remove_dir_all(saved_path.parent().unwrap()).unwrap();
}

#[test]
fn marker_stays_internal_and_other_responses_keep_their_shape() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let state_before =
        f.b.request(json!({"op":"state","token":f.owner_token}))
            .unwrap();
    let me_before =
        f.b.request(json!({"op":"me","token":f.owner_token}))
            .unwrap();
    let bot_before =
        f.b.request(json!({"op":"bot_get_me","bot_token":bt}))
            .unwrap();
    let updates_before =
        f.b.request(json!({"op":"bot_get_updates","bot_token":bt}))
            .unwrap();
    let update_keys = sorted_keys(&updates_before["updates"][0]);
    let result =
        f.b.request(call(&bt, f.owner_update, "avatar", &avatar_doc()))
            .unwrap();
    assert_eq!(sorted_keys(&result), vec!["user"]);
    assert_eq!(sorted_keys(&result["user"]), vec!["decorations", "id"]);
    let updates_after =
        f.b.request(json!({"op":"bot_get_updates","bot_token":bt}))
            .unwrap();
    assert!(!updates_after.to_string().contains(APPLIED));
    for update in arr(&updates_after["updates"]) {
        assert!(update.get(APPLIED).is_none(), "the marker must not leave");
        assert_eq!(
            sorted_keys(&update),
            update_keys,
            "the update DTO shape is unchanged"
        );
    }
    let state_after =
        f.b.request(json!({"op":"state","token":f.owner_token}))
            .unwrap();
    let me_after =
        f.b.request(json!({"op":"me","token":f.owner_token}))
            .unwrap();
    let bot_after =
        f.b.request(json!({"op":"bot_get_me","bot_token":bt}))
            .unwrap();
    assert_eq!(
        sorted_keys(&state_after),
        sorted_keys(&state_before),
        "state must not grow a marker field"
    );
    assert_eq!(
        sorted_keys(&bot_after),
        sorted_keys(&bot_before),
        "bot_get_me must not grow a marker field"
    );
    assert_eq!(
        sorted_keys(&me_after),
        sorted_keys(&me_before),
        "me must not grow a marker field"
    );
    for response in [&updates_after, &state_after, &me_after, &bot_after] {
        assert!(!response.to_string().contains(APPLIED));
        assert!(!response.to_string().contains("decoration_applied"));
    }
    drop(f.b);
    std::fs::remove_dir_all(f.path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn http_statuses_no_store_and_cookie_cannot_reach_the_operation() {
    let mut f = fixture();
    let bt = f.bot_token.clone();
    let foreign_bt = f.foreign_bot_token.clone();
    let owner_token = f.owner_token.clone();
    let owner_id = f.owner["id"].clone();
    // A second owner-authored update stays pending for the validation status checks.
    let (_, pending) = push_message(&mut f.b, &f.channel, &f.owner, "/ask later");
    let pending_update = f.owner_update;
    let backend = f.b;
    let path = f.path;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api", listener.local_addr().unwrap());
    let server =
        tokio::spawn(async move { axum::serve(listener, api_router(backend)).await.unwrap() });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .bearer_auth(&bt)
        .json(&call(&bt, pending_update, "avatar", &avatar_doc()))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body = response.json::<Value>().await.unwrap();
    let data = body["data"].clone();
    assert_eq!(data["user"]["id"], owner_id);
    assert_eq!(data["user"]["decorations"]["avatar"], avatar_doc());
    assert_eq!(sorted_keys(&data), vec!["user"]);
    assert_eq!(sorted_keys(&data["user"]), vec!["decorations", "id"]);
    for secret in ["hash", "salt", "email", "password", "token"] {
        assert!(!body.to_string().contains(secret), "{secret} leaked");
    }
    // Replay is a 400 conflict.
    let response = client
        .post(&url)
        .bearer_auth(&bt)
        .json(&call(&bt, pending_update, "avatar", &avatar_doc()))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(
        response.json::<Value>().await.unwrap()["error"],
        "BOT_DECORATION_CONFLICT"
    );
    // Invalid documents are a 400 and do not consume the pending update.
    let response = client
        .post(&url)
        .bearer_auth(&bt)
        .json(&call(
            &bt,
            pending,
            "avatar",
            &json!({"v":1,"target":"avatar","layers":[{"effect":"fire/fire-ring"}]}),
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(
        response.json::<Value>().await.unwrap()["error"],
        "BOT_DECORATION_INVALID"
    );
    let response = client
        .post(&url)
        .bearer_auth(&bt)
        .json(&call(&bt, pending, "avatar", &avatar_doc()))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    // Another bot's token cannot address this update: 403, not a conflict.
    let response = client
        .post(&url)
        .bearer_auth(&foreign_bt)
        .json(&call(&foreign_bt, pending, "avatar", &avatar_doc()))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 403);
    assert_eq!(
        response.json::<Value>().await.unwrap()["error"],
        "BOT_DECORATION_FORBIDDEN"
    );
    // A human cookie without a bot Bearer token is 401.
    let response = client
        .post(&url)
        .header("cookie", format!("mines_session={owner_token}"))
        .json(&call("", f.guest_update, "avatar", &avatar_doc()))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
    assert_eq!(
        response.json::<Value>().await.unwrap()["error"],
        "AUTH_REQUIRED"
    );
    server.abort();
    let _ = server.await;
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
