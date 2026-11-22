use super::*;

fn fixture() -> (Backend, Vec<Value>, Vec<String>, String) {
    let path = std::env::temp_dir().join(format!("sombra-mentions-{}", id())).join("db.json");
    let mut b = Backend::open(path).unwrap();
    let mut users = vec![b.db["users"][0].clone()];
    for (name, email) in [("LordDevil", "b@mentions.test"), ("Charlie", "c@mentions.test"), ("Outsider", "d@mentions.test")] {
        let u = b.new_user(name, email, "password123");
        b.db["users"].as_array_mut().unwrap().push(u.clone());
        users.push(u);
    }
    let tokens = users.iter().map(|u| b.token(u, "mentions", false).unwrap()).collect();
    let channel = id();
    b.db["dialogs"].as_array_mut().unwrap().push(json!({"id":channel,"members":[users[0]["id"],users[1]["id"],users[2]["id"]]}));
    b.save().unwrap();
    (b, users, tokens, channel)
}
fn clean(b: Backend) {
    let path = b.path.parent().unwrap().to_owned();
    drop(b);
    std::fs::remove_dir_all(path).unwrap();
}
fn send(b: &mut Backend, token: &str, ch: &str, text: &str) -> Value {
    b.request(json!({"op":"message","token":token,"channel":ch,"text":text})).unwrap();
    b.db["messages"].as_array().unwrap().last().unwrap().clone()
}
// Real HTTP surface: the actor comes only from the session cookie (or a bot bearer
// token), exactly like the deployed /api endpoint.
struct Api {
    url: String,
    client: reqwest::Client,
    task: tokio::task::JoinHandle<()>,
}
async fn api(b: Backend) -> Api {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, super::super::api_router(b)).await.unwrap();
    });
    let _ = rustls::crypto::ring::default_provider().install_default();
    Api { url, client: reqwest::Client::new(), task }
}
impl Api {
    async fn post(&self, header: (&str, String), body: Value) -> (u16, Value) {
        let response = self.client.post(&self.url).header(header.0, header.1).json(&body)
            .send().await.unwrap();
        let status = response.status().as_u16();
        (status, response.json::<Value>().await.unwrap())
    }
    async fn call(&self, token: &str, body: Value) -> (u16, Value) {
        self.post(("cookie", format!("mines_session={token}")), body).await
    }
    async fn bot(&self, token: &str, body: Value) -> (u16, Value) {
        self.post(("authorization", format!("Bearer {token}")), body).await
    }
    async fn ok(&self, token: &str, body: Value) -> Value {
        let (status, response) = self.call(token, body).await;
        assert_eq!(status, 200, "{response}");
        response["data"].clone()
    }
    async fn state(&self, token: &str) -> Value {
        self.ok(token, json!({"op":"state"})).await
    }
}
async fn stop(api: Api, path: std::path::PathBuf) {
    api.task.abort();
    let _ = api.task.await;
    clean(Backend::open(path).unwrap());
}
fn channel_counters(state: &Value, group: &str, channel: &str) -> (u64, u64) {
    let group = arr(&state["groups"]).into_iter().find(|g| g["id"] == group).unwrap();
    let channel = arr(&group["channels"]).into_iter().find(|c| c["id"] == channel).unwrap();
    (channel["unreadCount"].as_u64().unwrap(), channel["unreadMentionCount"].as_u64().unwrap())
}
fn dialog_mention_count(state: &Value, channel: &str) -> u64 {
    arr(&state["dialogs"]).into_iter().find(|d| d["id"] == channel).unwrap()["unreadMentionCount"]
        .as_u64().unwrap()
}
fn message(state: &Value, id: &Value) -> Value {
    arr(&state["messages"]).into_iter().find(|m| m["id"] == *id).unwrap()
}
#[test]
fn canonical_unicode_exclusions_and_immutable_profile_binding() {
    let (mut b, users, tokens, ch) = fixture();
    let m = send(&mut b, &tokens[0], &ch, "😀 привет @LordDevil!");
    assert_eq!(m["mentions"], json!([{"userId":users[1]["id"],"start":10,"end":20}]));
    b.db["users"][1]["name"] = json!("Renamed");
    assert_eq!(b.public_message(&m)["mentions"][0]["userId"], users[1]["id"]);
    b.db["users"][1]["name"] = json!("LordDevil");
    for text in ["mail@LordDevil", "\\@LordDevil", "`@LordDevil`", "```rust\n@LordDevil\n```", "~~~\n@LordDevil\n~~~", "[@LordDevil](https://example.test)", "[label](https://site.test/@LordDevil)", "https://site.test/@LordDevil", "<https://site.test/@LordDevil>", "@Outsider", "@LordDevilSuffix"] {
        assert_eq!(b.canonical_mentions(&ch, text, None).unwrap(), json!([]), "{text}");
    }
    let legacy = json!({"id":"legacy","text":"@LordDevil","channel":ch,"user":users[0]["id"]});
    let before = b.db.clone();
    assert_eq!(b.public_message(&legacy)["mentions"], json!([]));
    assert_eq!(before, b.db);
    clean(b);
}
#[test]
fn ambiguous_union_requires_valid_literal_scoped_proposal() {
    let (mut b, users, tokens, ch) = fixture();
    b.db["users"][2]["username"] = json!("LordDevil");
    assert_eq!(b.canonical_mentions(&ch,"@LordDevil",None).unwrap(),json!([]));
    let proposal = json!([{"userId":users[1]["id"],"start":0,"end":10}]);
    assert_eq!(b.canonical_mentions(&ch,"@LordDevil",Some(&proposal)).unwrap(),proposal);
    for p in [json!([{"userId":users[3]["id"],"start":0,"end":10}]), json!([{"userId":users[1]["id"],"start":1,"end":10}]), json!([{"userId":users[1]["id"],"start":0,"end":9}]), json!([{"userId":users[1]["id"],"start":0,"end":10},{"userId":users[2]["id"],"start":0,"end":10}]), json!(null)] {
        assert_eq!(b.canonical_mentions(&ch,"@LordDevil",Some(&p)).unwrap_err(), "INVALID_MENTIONS");
    }
    let unicode = json!([{"userId":users[1]["id"],"start":1,"end":12}]);
    assert!(b.canonical_mentions(&ch,"😀 @LordDevil",Some(&unicode)).is_err());
    assert!(b.request(json!({"op":"message","token":tokens[0],"channel":ch,"text":"`@LordDevil`","mentions":[{"userId":users[1]["id"],"start":1,"end":11}]})).is_err());
    let before = b.db["messages"].clone();
    b.db["users"][1]["name"] = json!("Renamed");
    assert!(b.request(json!({"op":"message","token":tokens[0],"channel":ch,"text":"@LordDevil","mentions":proposal})).is_err());
    assert_eq!(before,b.db["messages"]);
    clean(b);
}
#[test]
fn only_target_gets_badge_read_is_exact_and_edits_recompute() {
    let (mut b, users, tokens, ch) = fixture();
    let m = send(&mut b, &tokens[0], &ch, "@LordDevil @LordDevil");
    for (i, count) in [(0,0),(1,1),(2,0)] {
        let state = b.request(json!({"op":"state","token":tokens[i]})).unwrap();
        assert_eq!(state["dialogs"][0]["unreadMentionCount"], count);
        assert_eq!(state["messages"][0]["mentions"][0]["userId"], users[1]["id"]);
    }
    b.request(json!({"op":"mark_messages_read","token":tokens[2],"channel":ch,"messages":[m["id"]],"user":users[1]["id"]})).unwrap();
    assert_eq!(b.unread_mention_counts(s(&users[1],"id")).get(&ch),Some(&1));
    b.request(json!({"op":"update_message","token":tokens[0],"message":m["id"],"text":"@Charlie"})).unwrap();
    assert_eq!(b.unread_mention_counts(s(&users[1],"id")).get(&ch),None);
    // C read this exact message already: editing must not create a fresh ping.
    assert_eq!(b.unread_mention_counts(s(&users[2],"id")).get(&ch),None);
    let second = send(&mut b, &tokens[0], &ch, "@LordDevil");
    b.db["messages"].as_array_mut().unwrap().last_mut().unwrap()["time"] = json!(1);
    assert_eq!(b.unread_mention_counts(s(&users[1],"id")).get(&ch),Some(&1));
    b.request(json!({"op":"mark_messages_read","token":tokens[1],"channel":ch,"messages":[second["id"]]})).unwrap();
    assert_eq!(b.unread_mention_counts(s(&users[1],"id")).get(&ch),None);
    b.request(json!({"op":"update_message","token":tokens[0],"message":second["id"],"text":"removed"})).unwrap();
    assert_eq!(b.db["messages"].as_array().unwrap().last().unwrap()["mentions"],json!([]));
    clean(b);
}
#[test]
fn group_channels_revocation_and_self_mentions() {
    let (mut b, users, tokens, _) = fixture();
    let group = b.request(json!({"op":"create_group","token":tokens[0],"name":"Mentions"})).unwrap();
    let index = b.db["groups"].as_array().unwrap().iter().position(|g|g["id"]==group["id"]).unwrap();
    b.db["groups"][index]["members"] = json!([users[0]["id"],users[1]["id"],users[2]["id"]]);
    b.save().unwrap();
    let ch = s(&group["channels"][0],"id");
    send(&mut b,&tokens[1],ch,"@LordDevil");
    assert_eq!(b.unread_mention_counts(s(&users[1],"id")).get(ch),None);
    send(&mut b,&tokens[0],ch,"@LordDevil");
    let state = b.request(json!({"op":"state","token":tokens[1]})).unwrap();
    let dto = state["groups"].as_array().unwrap().iter().find(|g|g["id"]==group["id"]).unwrap();
    assert_eq!(dto["channels"][0]["unreadMentionCount"],1);
    b.db["groups"][index]["members"] = json!([users[0]["id"],users[2]["id"]]);
    assert_eq!(b.unread_mention_counts(s(&users[1],"id")).get(ch),None);
    assert_eq!(b.canonical_mentions(ch,"@LordDevil",None).unwrap(),json!([]));
    clean(b);
}
#[tokio::test]
async fn http_group_mention_badge_is_per_viewer_and_binding_survives_rename() {
    let (b, users, tokens, _) = fixture();
    let path = b.path.clone();
    let api = api(b).await;
    let (a, bb, cc) = (tokens[0].as_str(), tokens[1].as_str(), tokens[2].as_str());
    let group = api.ok(a, json!({"op":"create_group","name":"Mentions"})).await;
    let (gid, channel) = (s(&group,"id").to_owned(), s(&group["channels"][0],"id").to_owned());
    assert_eq!(s(&group["channels"][0],"kind"),"text");
    for token in [bb, cc] {
        api.ok(token, json!({"op":"join_group","invite":group["invite"]})).await;
    }
    let sent = api.ok(a, json!({"op":"message","channel":channel,"text":"@LordDevil"})).await;
    assert_eq!(sent["ok"], true);
    // A authored it, B is the only target, C merely unread: three distinct views.
    assert_eq!(channel_counters(&api.state(a).await,&gid,&channel), (0,0));
    let b_state = api.state(bb).await;
    assert_eq!(channel_counters(&b_state,&gid,&channel), (1,1));
    assert_eq!(channel_counters(&api.state(cc).await,&gid,&channel), (1,0));
    let first = arr(&b_state["messages"]).into_iter().find(|m| s(m,"channel")==channel).unwrap();
    assert_eq!(first["mentions"], json!([{"userId":users[1]["id"],"start":0,"end":10}]));
    // Renaming never retargets a stored mention: the record is an immutable user ID.
    api.ok(bb, json!({"op":"update_profile","profile":{"name":"Bravo","bio":""}})).await;
    api.ok(cc, json!({"op":"update_profile","profile":{"name":"LordDevil","bio":""}})).await;
    let b_renamed = api.state(bb).await;
    assert_eq!(message(&b_renamed,&first["id"])["mentions"], first["mentions"]);
    assert_eq!(channel_counters(&b_renamed,&gid,&channel), (1,1));
    assert_eq!(channel_counters(&api.state(cc).await,&gid,&channel), (1,0));
    // The literal name now belongs to C only, so a new message targets C.
    api.ok(a, json!({"op":"message","channel":channel,"text":"@LordDevil"})).await;
    let b_two = api.state(bb).await;
    let c_two = api.state(cc).await;
    let ids: Vec<Value> = arr(&b_two["messages"]).into_iter().filter(|m| s(m,"channel")==channel && m["user"]==users[0]["id"]).map(|m| m["id"].clone()).collect();
    assert_eq!(ids.len(), 2);
    assert_eq!(message(&c_two,&ids[1])["mentions"], json!([{"userId":users[2]["id"],"start":0,"end":10}]));
    assert_eq!(channel_counters(&b_two,&gid,&channel), (2,1));
    assert_eq!(channel_counters(&c_two,&gid,&channel), (2,1));
    // B reading clears only B's badge.
    api.ok(bb, json!({"op":"mark_messages_read","channel":channel,"messages":ids})).await;
    assert_eq!(channel_counters(&api.state(bb).await,&gid,&channel), (0,0));
    assert_eq!(channel_counters(&api.state(cc).await,&gid,&channel), (2,1));
    assert_eq!(channel_counters(&api.state(a).await,&gid,&channel), (0,0));
    // A mention of the author himself is stored but never counted as a badge.
    api.ok(bb, json!({"op":"message","channel":channel,"text":"@Bravo"})).await;
    let b_self = api.state(bb).await;
    let self_row = arr(&b_self["messages"]).into_iter().find(|m| s(m,"text")=="@Bravo").unwrap();
    assert_eq!(self_row["mentions"], json!([{"userId":users[1]["id"],"start":0,"end":6}]));
    assert_eq!(channel_counters(&b_self,&gid,&channel), (0,0));
    assert_eq!(channel_counters(&api.state(cc).await,&gid,&channel), (3,1));
    assert_eq!(channel_counters(&api.state(a).await,&gid,&channel), (1,0));
    // Counter are a projection: capabilities and the channel shape stay unchanged.
    let state = api.state(a).await;
    let mut flags = state.as_object().unwrap().keys().filter(|k| k.ends_with("Supported")).cloned().collect::<Vec<_>>();
    flags.sort();
    assert_eq!(flags, ["conversationMemberSearchSupported","decorationSupported","dialogMetadataSupported","effectCatalogSupported","humanTypingSupported","profileEffectDraftsSupported","profileEffectUploadsSupported","readReceiptsSupported","stickerCatalogSupported"]);
    assert!(!state.as_object().unwrap().keys().any(|k| k.to_ascii_lowercase().contains("mention")));
    let group_dto = arr(&state["groups"]).into_iter().find(|g| g["id"]==gid).unwrap();
    let channel_dto = arr(&group_dto["channels"]).into_iter().find(|c| c["id"]==channel).unwrap();
    let mut keys = channel_dto.as_object().unwrap().keys().cloned().collect::<Vec<_>>();
    keys.sort();
    assert_eq!(keys, ["id","kind","name","unreadCount","unreadMentionCount"]);
    stop(api, path).await;
}
#[tokio::test]
async fn http_mention_exclusions_and_invalid_proposals_create_no_records() {
    let (b, users, tokens, ch) = fixture();
    let path = b.path.clone();
    let api = api(b).await;
    let (a, outs) = (tokens[0].as_str(), users[3]["id"].clone());
    let excluded_texts = [
        "mail@LordDevil", "LordDevil@example.test", "\\@LordDevil", "@@LordDevil",
        "`@LordDevil`", "```rust\n@LordDevil\n```", "~~~\n@LordDevil\n~~~",
        "[@LordDevil](https://example.test)", "[label](https://site.test/@LordDevil)",
        "https://site.test/@LordDevil", "<https://site.test/@LordDevil>",
        "@Outsider", "@LordDevilSuffix",
    ];
    for text in excluded_texts {
        let (status, response) = api.call(a, json!({"op":"message","channel":ch,"text":text})).await;
        assert_eq!(status, 200, "{text}: {response}");
    }
    let state = api.state(a).await;
    let rows = arr(&state["messages"]);
    assert_eq!(rows.len(), excluded_texts.len());
    for row in &rows {
        assert_eq!(row["mentions"], json!([]), "{}", row["text"]);
    }
    // Proposals are hints with a single authority: the literal, scoped candidate.
    let text = "@LordDevil @Charlie";
    let (bb, cc) = (users[1]["id"].clone(), users[2]["id"].clone());
    let invalid = [
        ("duplicate", json!([{"userId":bb,"start":0,"end":10},{"userId":bb,"start":0,"end":10}])),
        ("overlap", json!([{"userId":cc,"start":11,"end":19},{"userId":bb,"start":0,"end":10}])),
        ("foreign user", json!([{"userId":outs,"start":0,"end":10}])),
        ("wrong target", json!([{"userId":cc,"start":0,"end":10}])),
        ("truncated", json!([{"userId":bb,"start":0,"end":9}])),
        ("shifted start", json!([{"userId":bb,"start":1,"end":10}])),
        ("beyond text", json!([{"userId":bb,"start":0,"end":30}])),
        ("null", json!(null)),
        ("too many rows", json!((0..101).map(|_| json!({"userId":bb,"start":0,"end":10})).collect::<Vec<_>>())),
    ];
    for (label, mentions) in invalid {
        let (status, response) = api.call(a, json!({"op":"message","channel":ch,"text":text,"mentions":mentions})).await;
        assert_eq!(status, 400, "{label}: {response}");
        assert_eq!(response["error"], "INVALID_MENTIONS", "{label}");
    }
    let after = api.state(a).await;
    assert_eq!(arr(&after["messages"]).len(), excluded_texts.len());
    // A rejected edit leaves both text and canonical mentions untouched.
    let (status, response) = api.call(a, json!({"op":"message","channel":ch,"text":"@LordDevil"})).await;
    assert_eq!(status, 200, "{response}");
    let stored = arr(&api.state(a).await["messages"]).into_iter().find(|m| s(m,"text")=="@LordDevil").unwrap();
    assert_eq!(stored["mentions"], json!([{"userId":bb,"start":0,"end":10}]));
    let edited = json!({"op":"update_message","message":stored["id"],"text":text,"mentions":[{"userId":outs,"start":0,"end":10}]});
    let (status, response) = api.call(a, edited).await;
    assert_eq!(status, 400, "{response}");
    assert_eq!(response["error"], "INVALID_MENTIONS");
    let unchanged = message(&api.state(a).await, &stored["id"]);
    assert_eq!(unchanged["text"], "@LordDevil");
    assert_eq!(unchanged["mentions"], stored["mentions"]);
    stop(api, path).await;
}
#[tokio::test]
async fn http_edit_recomputes_mentions_on_each_valid_revision() {
    let (b, users, tokens, ch) = fixture();
    let path = b.path.clone();
    let api = api(b).await;
    let (a, bb, cc) = (tokens[0].as_str(), tokens[1].as_str(), tokens[2].as_str());
    api.ok(a, json!({"op":"message","channel":ch,"text":"@LordDevil"})).await;
    let b_state = api.state(bb).await;
    assert_eq!(dialog_mention_count(&b_state, &ch), 1);
    let mid = arr(&b_state["messages"]).into_iter().find(|m| s(m,"channel")==ch).unwrap()["id"].clone();
    api.ok(a, json!({"op":"update_message","message":mid,"text":"@Charlie"})).await;
    assert_eq!(dialog_mention_count(&api.state(bb).await, &ch), 0);
    assert_eq!(dialog_mention_count(&api.state(cc).await, &ch), 1);
    assert_eq!(message(&api.state(a).await, &mid)["mentions"], json!([{"userId":users[2]["id"],"start":0,"end":8}]));
    // A valid explicit proposal for the same revision is accepted as-is.
    let proposal = json!([{"userId":users[1]["id"],"start":0,"end":10}]);
    api.ok(a, json!({"op":"update_message","message":mid,"text":"@LordDevil","mentions":proposal})).await;
    assert_eq!(message(&api.state(a).await, &mid)["mentions"], proposal);
    assert_eq!(dialog_mention_count(&api.state(bb).await, &ch), 1);
    assert_eq!(dialog_mention_count(&api.state(cc).await, &ch), 0);
    // Markdown code means the literal text is not a mention any more.
    api.ok(a, json!({"op":"update_message","message":mid,"text":"`@LordDevil`"})).await;
    assert_eq!(dialog_mention_count(&api.state(bb).await, &ch), 0);
    assert_eq!(message(&api.state(a).await, &mid)["mentions"], json!([]));
    // Removing the mention and re-adding it recomputes from the current revision.
    api.ok(a, json!({"op":"update_message","message":mid,"text":"plain"})).await;
    assert_eq!(dialog_mention_count(&api.state(bb).await, &ch), 0);
    api.ok(a, json!({"op":"update_message","message":mid,"text":"@LordDevil"})).await;
    assert_eq!(dialog_mention_count(&api.state(bb).await, &ch), 1);
    assert_eq!(dialog_mention_count(&api.state(cc).await, &ch), 0);
    stop(api, path).await;
}
#[tokio::test]
async fn http_bot_messages_carry_canonical_mentions_without_new_metadata() {
    let (b, users, tokens, _) = fixture();
    let path = b.path.clone();
    let api = api(b).await;
    let (a, bb) = (tokens[0].as_str(), tokens[1].as_str());
    let group = api.ok(a, json!({"op":"create_group","name":"Bot mentions"})).await;
    let (gid, channel) = (s(&group,"id").to_owned(), s(&group["channels"][0],"id").to_owned());
    api.ok(bb, json!({"op":"join_group","invite":group["invite"]})).await;
    let bot = api.ok(a, json!({"op":"create_bot","channel":channel,"name":"Helper"})).await;
    let bot_token = s(&bot,"token").to_owned();
    let (status, response) = api.bot(&bot_token, json!({"op":"bot_message","text":"Hi @LordDevil"})).await;
    assert_eq!(status, 200, "{response}");
    let state = api.state(bb).await;
    let row = arr(&state["messages"]).into_iter().find(|m| s(m,"channel")==channel).unwrap();
    assert_eq!(row["bot_name"], "Helper");
    assert_eq!(row["mentions"], json!([{"userId":users[1]["id"],"start":3,"end":13}]));
    assert_eq!(channel_counters(&state, &gid, &channel), (1,1));
    // A sees the bot message as unread but is not mentioned.
    assert_eq!(channel_counters(&api.state(a).await, &gid, &channel), (1,0));
    // The bot's own capability/report metadata is unchanged by mentions.
    let (status, me) = api.bot(&bot_token, json!({"op":"bot_get_me"})).await;
    assert_eq!(status, 200, "{me}");
    let mut keys = me["data"].as_object().unwrap().keys().cloned().collect::<Vec<_>>();
    keys.sort();
    assert_eq!(keys, ["bot","commandRegistrationSupported","installs","toolPolicy","user"]);
    stop(api, path).await;
}
