use super::*;

fn fixture() -> (Backend, Value, Value, String, String, String) {
    let path = std::env::temp_dir()
        .join(format!("sombra-reads-{}", id()))
        .join("db.json");
    let mut b = Backend::open(path).unwrap();
    let a = b.db["users"][0].clone();
    let c = b.new_user("Reader", "reader@example.test", "password123");
    let at = b.token(&a, "one", false).unwrap();
    b.db["users"].as_array_mut().unwrap().push(c.clone());
    let ct = b.token(&c, "two", false).unwrap();
    let channel = id();
    b.db["dialogs"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":channel,"members":[a["id"],c["id"]]}));
    b.save().unwrap();
    (b, a, c, at, ct, channel)
}
fn send(b: &mut Backend, token: &str, channel: &str) -> String {
    b.request(json!({"op":"message","token":token,"channel":channel,"text":"hello"}))
        .unwrap();
    s(b.db["messages"].as_array().unwrap().last().unwrap(), "id").to_owned()
}
fn badge(b: &Backend, uid: &str, channel: &str) -> usize {
    b.unread_count(uid, channel)
}
fn clean(b: Backend) {
    let path = b.path.parent().unwrap().to_path_buf();
    drop(b);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn exact_visible_ids_not_watermarks_and_first_view_is_immutable() {
    let (mut b, a, c, at, ct, ch) = fixture();
    let first = send(&mut b, &at, &ch);
    let middle = send(&mut b, &at, &ch);
    let last = send(&mut b, &at, &ch);
    assert_eq!(badge(&b, s(&c, "id"), &ch), 3);
    b.request(json!({"op":"mark_messages_read","token":ct,"channel":ch,"messages":[middle],"user":a["id"],"seq":999999})).unwrap();
    assert_eq!(badge(&b, s(&c, "id"), &ch), 2);
    assert!(b.db["read_state"]["viewers"][&first].is_null());
    assert!(b.db["read_state"]["viewers"][&last].is_null());
    assert!(
        b.db["read_state"]["viewers"][&middle][s(&c, "id")]
            .as_u64()
            .unwrap()
            > 0
    );
    // Use an older persisted timestamp so a same-second accidental rewrite fails.
    b.db["read_state"]["viewers"][&middle][s(&c, "id")] = json!(123);
    b.save().unwrap();
    let readers = b
        .request(json!({"op":"message_readers","token":at,"message":middle}))
        .unwrap();
    assert_eq!(readers["readers"][0]["user"], c["id"]);
    let own_dto = b.receipt_message(&b.db["messages"][1], s(&a, "id"));
    assert_eq!(own_dto["readCount"], 1);
    assert_eq!(own_dto["readAt"], 123);
    b.request(
        json!({"op":"mark_messages_read","token":ct,"channel":ch,"messages":[middle,middle]}),
    )
    .unwrap();
    assert_eq!(
        readers,
        b.request(json!({"op":"message_readers","token":at,"message":middle}))
            .unwrap()
    );
    let second_device = b.token(&c, "reader other device", false).unwrap();
    b.request(
        json!({"op":"mark_messages_read","token":second_device,"channel":ch,"messages":[middle]}),
    )
    .unwrap();
    assert_eq!(
        readers,
        b.request(json!({"op":"message_readers","token":at,"message":middle}))
            .unwrap()
    );
    let own_device = b.token(&a, "author second device", false).unwrap();
    b.request(
        json!({"op":"mark_messages_read","token":own_device,"channel":ch,"messages":[first]}),
    )
    .unwrap();
    assert_eq!(
        b.receipt_message(&b.db["messages"][0], s(&a, "id"))["readCount"],
        0
    );
    let state = b.request(json!({"op":"state","token":ct})).unwrap();
    assert_eq!(state["dialogs"][0]["unreadCount"], 2);
    assert_eq!(state["readReceiptsSupported"], true);
    assert!(state["messages"][1].get("readCount").is_none());
    assert!(!state.to_string().contains("baselines"));
    assert!(!state.to_string().contains("viewers"));
    clean(b);
}

#[test]
fn baseline_migration_never_fakes_receipts_and_sequences_survive_deletion_restart() {
    let (mut b, a, c, at, ct, ch) = fixture();
    send(&mut b, &at, &ch);
    send(&mut b, &at, &ch);
    b.db.as_object_mut().unwrap().remove("read_state");
    b.db.as_object_mut().unwrap().remove("next_seq");
    for m in b.db["messages"].as_array_mut().unwrap() {
        m.as_object_mut().unwrap().remove("messageSeq");
        m["time"] = json!(10);
    }
    b.save().unwrap();
    assert_eq!(badge(&b, s(&c, "id"), &ch), 0);
    assert_eq!(b.db["messages"][0]["messageSeq"], 1);
    assert_eq!(b.db["messages"][1]["messageSeq"], 2);
    assert_eq!(
        b.receipt_message(&b.db["messages"][1], s(&a, "id"))["readCount"],
        0
    );
    let new = send(&mut b, &at, &ch);
    assert_eq!(badge(&b, s(&c, "id"), &ch), 1);
    b.request(json!({"op":"mark_messages_read","token":ct,"channel":ch,"messages":[new]}))
        .unwrap();
    b.request(json!({"op":"delete_message","token":at,"message":new,"for_everyone":true}))
        .unwrap();
    let path = b.path.clone();
    drop(b);
    let mut b = Backend::open(path).unwrap();
    send(&mut b, &at, &ch);
    assert_eq!(b.db["messages"][2]["messageSeq"], 4);
    assert_eq!(badge(&b, s(&c, "id"), &ch), 1);
    clean(b);
}

#[test]
fn batch_validation_atomic_hidden_crossroom_limits_and_author_privacy() {
    let (mut b, a, c, at, ct, ch) = fixture();
    let first = send(&mut b, &at, &ch);
    let alien = id();
    b.db["dialogs"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":alien,"members":[a["id"]]}));
    b.save().unwrap();
    let secret = send(&mut b, &at, &alien);
    for ids in [
        json!([first, secret]),
        json!([first, 42]),
        json!([]),
        json!(vec![first.clone(); 101]),
    ] {
        assert!(b
            .request(json!({"op":"mark_messages_read","token":ct,"channel":ch,"messages":ids}))
            .is_err());
        assert!(b.db["read_state"]["viewers"][&first].is_null());
    }
    assert!(b
        .request(json!({"op":"message_readers","token":ct,"message":first}))
        .is_err());
    b.request(json!({"op":"delete_message","token":ct,"message":first}))
        .unwrap();
    assert_eq!(badge(&b, s(&c, "id"), &ch), 0);
    assert!(b
        .request(json!({"op":"mark_messages_read","token":ct,"channel":ch,"messages":[first]}))
        .is_err());
    assert!(b
        .request(json!({"op":"message_readers","message":first}))
        .is_err());
    clean(b);
}

#[test]
fn bot_incoming_media_and_group_membership() {
    let (mut b, a, c, at, ct, ch) = fixture();
    let bot = id();
    b.db["users"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":bot,"bot":true}));
    // Simulate a creator not using the human message action, e.g. bot/notification.
    let mid = id();
    b.db["messages"].as_array_mut().unwrap().push(json!({"id":mid,"channel":ch,"user":bot,"time":now(),"attachment":{"name":"expired.bin","created_at":0}}));
    b.save().unwrap();
    assert!(b.db["messages"][0]["messageSeq"].as_u64().is_some());
    assert_eq!(badge(&b, s(&c, "id"), &ch), 1);
    b.request(json!({"op":"mark_messages_read","token":ct,"channel":ch,"messages":[mid]}))
        .unwrap();
    assert_eq!(badge(&b, s(&c, "id"), &ch), 0);
    let bt = b.token(&json!({"id":bot}), "bot", false).unwrap();
    assert!(b
        .request(json!({"op":"mark_messages_read","token":bt,"channel":ch,"messages":[mid]}))
        .is_err());
    let group = b
        .request(json!({"op":"create_group","token":at,"name":"Readers"}))
        .unwrap();
    let channel = s(&group["channels"][0], "id").to_owned();
    let old = send(&mut b, &at, &channel);
    let invite = b.db["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["id"] == group["id"])
        .unwrap()["invite"]
        .clone();
    b.request(json!({"op":"join_group","token":ct,"invite":invite}))
        .unwrap();
    assert_eq!(badge(&b, s(&c, "id"), &channel), 0);
    b.request(json!({"op":"mark_messages_read","token":ct,"channel":channel,"messages":[old]}))
        .unwrap();
    b.request(json!({"op":"leave_group","token":ct,"group":group["id"]}))
        .unwrap();
    assert!(b
        .request(json!({"op":"mark_messages_read","token":ct,"channel":channel,"messages":[old]}))
        .is_err());
    assert_eq!(
        b.request(json!({"op":"message_readers","token":at,"message":old}))
            .unwrap()["readers"][0]["user"],
        c["id"]
    );
    b.db["groups"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|g| g["id"] == group["id"])
        .unwrap()["members"] = json!([]);
    b.save().unwrap();
    assert!(b
        .request(json!({"op":"message_readers","token":at,"message":old}))
        .is_err());
    assert_eq!(a["bot"], Value::Null);
    clean(b);
}

#[test]
fn every_creator_normalizes_and_internal_sequences_never_escape_bot_or_human_dtos() {
    let (mut b, a, _c, at, _ct, ch) = fixture();
    let group = b.db["groups"][0].clone();
    let channel = s(&group["channels"][0], "id").to_owned();
    let legacy = b
        .request(json!({"op":"create_bot","token":at,"channel":channel,"name":"Legacy"}))
        .unwrap();
    b.request(json!({"op":"bot_message","bot_token":legacy["token"],"text":"legacy"}))
        .unwrap();
    let modern=b.request(json!({"op":"create_bot","token":at,"group":group["id"],"name":"Modern","username":"modernreads"})).unwrap();
    b.request(json!({"op":"message","token":at,"channel":channel,"text":"/ask@modernreads hi"}))
        .unwrap();
    let updates = b
        .request(json!({"op":"bot_get_updates","bot_token":modern["token"]}))
        .unwrap();
    let update = updates["updates"].as_array().unwrap().last().unwrap()["update_id"].clone();
    let reply =
        json!({"op":"bot_reply","bot_token":modern["token"],"update_id":update,"text":"reply"});
    let response = b.request(reply.clone()).unwrap();
    let edited=b.request(json!({"op":"bot_edit","bot_token":modern["token"],"update_id":update,"text":"edited","revision":1})).unwrap();
    assert!(response.get("messageSeq").is_none());
    assert!(edited.get("messageSeq").is_none());
    // Replay cached edited output: its storage snapshot may carry internal sequence.
    let replay=b.request(json!({"op":"bot_edit","bot_token":modern["token"],"update_id":update,"text":"edited","revision":1})).unwrap();
    assert!(replay.get("messageSeq").is_none());
    send(&mut b, &at, &ch);
    let seqs: Vec<_> = b.db["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["messageSeq"].as_u64().unwrap())
        .collect();
    assert_eq!(seqs, vec![1, 2, 3, 4]);
    let poll = b
        .request(json!({"op":"bot_poll","bot_token":legacy["token"]}))
        .unwrap();
    let state = b.state(&a, false);
    for dto in [poll, state, updates, replay] {
        assert!(!dto.to_string().contains("messageSeq"));
        assert!(!dto.to_string().contains("next_seq"));
        assert!(!dto.to_string().contains("read_state"));
    }
    clean(b);
}

#[test]
fn new_account_join_rejoin_baselines_are_badge_only() {
    let (mut b, _a, c, at, ct, ch) = fixture();
    let old = send(&mut b, &at, &ch);
    let registered=b.request(json!({"op":"register","name":"Newbie","email":"new@reads.test","password":"longpassword"})).unwrap();
    let uid = s(&registered["user"], "id");
    assert_eq!(b.db["read_state"]["baselines"][uid]["global"], 1);
    b.db["dialogs"][0]["members"]
        .as_array_mut()
        .unwrap()
        .push(json!(uid));
    b.save().unwrap();
    assert_eq!(badge(&b, uid, &ch), 0);
    let next = send(&mut b, &at, &ch);
    assert_eq!(badge(&b, uid, &ch), 1);
    assert_eq!(
        b.request(json!({"op":"message_readers","token":at,"message":old}))
            .unwrap()["readers"],
        json!([])
    );
    b.db["dialogs"][0]["members"]
        .as_array_mut()
        .unwrap()
        .retain(|u| u != &c["id"]);
    b.save().unwrap();
    b.db["dialogs"][0]["members"]
        .as_array_mut()
        .unwrap()
        .push(c["id"].clone());
    b.save().unwrap();
    assert_eq!(badge(&b, s(&c, "id"), &ch), 0);
    b.request(json!({"op":"mark_messages_read","token":ct,"channel":ch,"messages":[old,next]}))
        .unwrap();
    assert_eq!(
        b.request(json!({"op":"message_readers","token":at,"message":old}))
            .unwrap()["readers"][0]["user"],
        c["id"]
    );
    clean(b);
}

#[test]
fn request_migration_save_failure_rolls_back_and_retry_persists_sequences() {
    let (mut b, _a, c, _at, ct, ch) = fixture();
    b.db["messages"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":id(),"channel":ch,"user":"notification","text":"new","time":now()}));
    let previous = b.db.clone();
    let path = b.path.clone();
    b.path = path
        .parent()
        .unwrap()
        .join("missing-parent")
        .join("db.json");
    assert!(b.request(json!({"op":"state","token":ct})).is_err());
    assert_eq!(b.db, previous);
    b.path = path.clone();
    b.request(json!({"op":"state","token":ct})).unwrap();
    assert_eq!(badge(&b, s(&c, "id"), &ch), 1);
    let persisted: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(persisted["messages"][0]["messageSeq"], 1);
    assert_eq!(persisted["next_seq"], 2);
    clean(b);
}

#[tokio::test]
async fn real_http_cookie_actor_cannot_be_forged_and_receipts_survive_restart() {
    let (mut b, a, c, at, ct, ch) = fixture();
    let mid = send(&mut b, &at, &ch);
    let path = b.path.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, super::super::api_router(b))
            .await
            .unwrap();
    });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let url = format!("http://{address}/api");
    let no_cookie = client
        .post(&url)
        .json(&json!({"op":"mark_messages_read","token":ct,"channel":ch,"messages":[mid]}))
        .send()
        .await
        .unwrap();
    assert_eq!(no_cookie.status(), 401);
    let author=client.post(&url).header("cookie",format!("mines_session={at}")).json(&json!({"op":"mark_messages_read","token":ct,"user":c["id"],"channel":ch,"messages":[mid]})).send().await.unwrap();
    assert_eq!(author.status(), 200);
    let count = client
        .post(&url)
        .header("cookie", format!("mines_session={at}"))
        .json(&json!({"op":"message_readers","message":mid}))
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(count["data"]["readers"], json!([]));
    let read = client
        .post(&url)
        .header("cookie", format!("mines_session={ct}"))
        .json(&json!({"op":"mark_messages_read","user":a["id"],"channel":ch,"messages":[mid]}))
        .send()
        .await
        .unwrap();
    assert_eq!(read.status(), 200);
    let denied = client
        .post(&url)
        .header("cookie", format!("mines_session={ct}"))
        .json(&json!({"op":"message_readers","message":mid}))
        .send()
        .await
        .unwrap();
    assert!(!denied.status().is_success());
    task.abort();
    let _ = task.await;
    let mut b = Backend::open(path).unwrap();
    let readers = b
        .request(json!({"op":"message_readers","token":at,"message":mid}))
        .unwrap();
    assert_eq!(
        readers["readers"],
        json!([{ "user":c["id"],"seenAt":readers["readers"][0]["seenAt"] }])
    );
    clean(b);
}
