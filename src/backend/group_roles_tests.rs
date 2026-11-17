use super::*;
#[test]
fn text_voice_cross_group_sticker_bot_and_private_file_boundaries() {
    let (mut b, ot, at, _) = fixture();
    call(&mut b,&ot,json!({"op":"save_group_role","role":"admin","name":"Text only","permissions":["channels.create_text"],"revision":0})).unwrap();
    assign(&mut b, &ot, "alice", "admin");
    call(
        &mut b,
        &at,
        json!({"op":"create_channel","kind":"text","name":"Allowed"}),
    )
    .unwrap();
    assert!(call(
        &mut b,
        &at,
        json!({"op":"create_channel","kind":"voice","name":"Denied"})
    )
    .is_err());
    assert!(call(
        &mut b,
        &at,
        json!({"op":"create_bot","name":"Bot","username":"deniedbot"})
    )
    .is_err());
    assert!(call(&mut b,&at,json!({"op":"import_sticker_pack","pack":"Denied","stickers":[{"name":"Test","image":"data:image/png;base64,iVBORw0KGgo="}]})).is_err());
    let other = call(&mut b, &ot, json!({"op":"create_group","name":"Private"})).unwrap();
    let channel = other["channels"][0]["id"].clone();
    call(
        &mut b,
        &ot,
        json!({"op":"message","channel":channel,"attachment":{"name":"private.txt","data":"YQ=="}}),
    )
    .unwrap();
    let private_file = b.db["messages"].as_array().unwrap().last().unwrap()["id"].clone();
    assert_eq!(
        call(
            &mut b,
            &ot,
            json!({"op":"attachment_file","message":private_file})
        )
        .unwrap()["data"],
        "YQ=="
    );
    assert!(call(
        &mut b,
        &at,
        json!({"op":"create_channel","group":other["id"],"kind":"text","name":"Denied"})
    )
    .is_err());
    let owner = b.db["groups"][0]["owner"].clone();
    b.db["messages"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"secret-message","channel":channel,"user":owner,"text":"Secret"}));
    let rev = b.db["groups"][0]["roles_revision"].clone();
    call(&mut b,&ot,json!({"op":"save_group_role","role":"admin","name":"Moderator","permissions":["messages.delete_any"],"revision":rev})).unwrap();
    assert!(call(
        &mut b,
        &at,
        json!({"op":"delete_message","message":"secret-message","for_everyone":true})
    )
    .is_err());
    assert!(call(
        &mut b,
        &at,
        json!({"op":"attachment_file","message":private_file})
    )
    .is_err());
    let accessible = b.db["groups"][0]["channels"][0]["id"].clone();
    b.db["messages"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"public-message","channel":accessible,"user":"bob","text":"Visible"}));
    assert!(call(
        &mut b,
        &at,
        json!({"op":"update_message","message":"public-message","text":"Forbidden"})
    )
    .is_err());
    call(
        &mut b,
        &at,
        json!({"op":"delete_message","message":"public-message","for_everyone":true}),
    )
    .unwrap();
    assert!(b.db["messages"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["id"] == "secret-message"));
}
#[test]
fn strict_role_limits_uuid_creation_and_unknown_assignments() {
    let (mut b, ot, _, _) = fixture();
    for name in ["".to_string(), " ".to_string(), "x".repeat(41)] {
        assert!(call(
            &mut b,
            &ot,
            json!({"op":"save_group_role","name":name,"permissions":[],"revision":0})
        )
        .is_err());
    }
    for n in 0..30 {
        let result=call(&mut b,&ot,json!({"op":"save_group_role","name":format!("Role {n}"),"permissions":[],"revision":n})).unwrap();
        let role = result["roles"].as_array().unwrap().last().unwrap()["id"]
            .as_str()
            .unwrap();
        assert!(uuid::Uuid::parse_str(role).is_ok());
    }
    assert!(call(
        &mut b,
        &ot,
        json!({"op":"save_group_role","name":"Overflow","permissions":[],"revision":30})
    )
    .is_err());
    b.db["groups"][0]["memberRoles"] = json!({"alice":"unknown","ghost":"admin"});
    let dto = b.group_dto(&b.db["groups"][0], "alice");
    assert_eq!(dto["memberRoles"], json!({}));
    assert_eq!(dto["permissions"], json!([]));
    // Legacy groups cannot acquire admin assignments merely from an unrecognized raw map.
    b.db["groups"][0].as_object_mut().unwrap().remove("roles");
    b.db["groups"][0]["memberRoles"] = json!({"alice":"admin"});
    assert_eq!(
        b.group_dto(&b.db["groups"][0], "alice")["permissions"],
        json!([])
    );
}
fn fixture() -> (Backend, String, String, String) {
    let path = std::env::temp_dir().join(id()).join("db.json");
    let mut b = Backend::open(path).unwrap();
    let owner = b.db["users"][0].clone();
    let alice = json!({"id":"alice","name":"Alice"});
    let bob = json!({"id":"bob","name":"Bob","email":"bob@test.local"});
    b.db["users"]
        .as_array_mut()
        .unwrap()
        .extend([alice.clone(), bob.clone()]);
    b.db["groups"][0]["members"]
        .as_array_mut()
        .unwrap()
        .extend([json!("alice"), json!("bob")]);
    let ot = b.token(&owner, "test", false).unwrap();
    let at = b.token(&alice, "test", false).unwrap();
    let bt = b.token(&bob, "test", false).unwrap();
    (b, ot, at, bt)
}
fn call(b: &mut Backend, token: &str, mut v: Value) -> Result<Value, String> {
    v["token"] = json!(token);
    if v.get("group").is_none() {
        v["group"] = b.db["groups"][0]["id"].clone();
    }
    b.request(v)
}
fn assign(b: &mut Backend, owner: &str, user: &str, role: &str) {
    let revision = b.db["groups"][0]["roles_revision"].as_u64().unwrap_or(0);
    call(
        b,
        owner,
        json!({"op":"set_group_member_role","user":user,"role":role,"revision":revision}),
    )
    .unwrap();
}
#[test]
fn legacy_defaults_revision_guards_normalization_and_reopen() {
    let (mut b, ot, at, _) = fixture();
    let g = b.db["groups"][0].clone();
    let owner = s(&g, "owner");
    let dto = b.group_dto(&g, owner);
    assert_eq!(dto["roles"].as_array().unwrap().len(), 2);
    assert_eq!(dto["permissions"], json!(MANAGEMENT));
    assert_eq!(b.group_dto(&g, "alice")["permissions"], json!([]));
    assert_eq!(dto["memberRoles"], json!({}));
    for v in [
        json!({"op":"save_group_role","name":"Bad","permissions":[]}),
        json!({"op":"save_group_role","name":"Bad","permissions":["unknown"],"revision":0}),
        json!({"op":"save_group_role","name":"Bad","permissions":["group.rename","group.rename"],"revision":0}),
        json!({"op":"save_group_role","role":"owner","name":"Owner","permissions":[],"revision":0}),
        json!({"op":"save_group_role","role":7,"name":"Bad","permissions":[],"revision":0}),
    ] {
        assert!(call(&mut b, &ot, v).is_err());
    }
    assert!(call(
        &mut b,
        &at,
        json!({"op":"set_group_member_role","user":"alice","role":"admin","revision":0})
    )
    .is_err());
    assign(&mut b, &ot, "alice", "admin");
    assert_eq!(
        b.group_dto(&b.db["groups"][0], "alice")["permissions"],
        json!(MANAGEMENT)
    );
    assert!(call(
        &mut b,
        &ot,
        json!({"op":"set_group_member_role","user":"bob","role":"admin","revision":0})
    )
    .is_err());
    let revision = b.db["groups"][0]["roles_revision"].clone();
    for user in [owner, "missing"] {
        assert!(call(
            &mut b,
            &ot,
            json!({"op":"set_group_member_role","user":user,"role":"admin","revision":revision})
        )
        .is_err());
    }
    let removed = call(
        &mut b,
        &ot,
        json!({"op":"delete_group_role","role":"admin","revision":revision}),
    )
    .unwrap();
    assert_eq!(removed["memberRoles"]["alice"], "member");
    assert_eq!(
        b.group_dto(&b.db["groups"][0], "alice")["permissions"],
        json!([])
    );
    assert!(call(
        &mut b,
        &ot,
        json!({"op":"delete_group_role","role":"member","revision":removed["rolesRevision"]})
    )
    .is_err());
    let path = b.path.clone();
    drop(b);
    let b = Backend::open(path).unwrap();
    assert_eq!(
        b.group_dto(&b.db["groups"][0], "alice")["roles"],
        removed["roles"]
    );
    assert_eq!(
        b.db["groups"][0]["roles_revision"],
        removed["rolesRevision"]
    );
}
#[test]
fn all_twelve_permissions_gate_real_operations_and_revoke_immediately() {
    let (mut b, ot, at, _) = fixture();
    let group = b.db["groups"][0].clone();
    let cid = group["channels"][0]["id"].clone();
    b.db["messages"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"moderate","user":"bob","channel":cid,"text":"Other"}));
    let operations = vec![
        json!({"op":"update_group","name":"Renamed"}),
        json!({"op":"update_group","avatar":""}),
        json!({"op":"create_channel","kind":"text","name":"Text"}),
        json!({"op":"create_channel","kind":"voice","name":"Voice"}),
        json!({"op":"update_channel","channel":cid,"name":"Renamed"}),
        json!({"op":"delete_channel","channel":cid}),
        json!({"op":"invite_group_member","email":"bob@test.local"}),
        json!({"op":"rotate_group_invite"}),
        json!({"op":"kick_group_member","user":"bob"}),
        json!({"op":"delete_message","message":"moderate","for_everyone":true}),
        json!({"op":"import_sticker_pack","pack":"Test","stickers":[{"name":"Test","image":"data:image/png;base64,iVBORw0KGgo="}]}),
        json!({"op":"create_bot","name":"Helper","username":"helper"}),
    ];
    for (key, operation) in MANAGEMENT.iter().zip(operations) {
        assert!(
            call(&mut b, &at, operation.clone()).is_err(),
            "denied {key}"
        );
        let rev = b.db["groups"][0]["roles_revision"].as_u64().unwrap_or(0);
        call(&mut b,&ot,json!({"op":"save_group_role","role":"admin","name":"One grant","permissions":[key],"revision":rev})).unwrap();
        assign(&mut b, &ot, "alice", "admin");
        assert_eq!(
            b.group_dto(&b.db["groups"][0], "alice")["permissions"],
            json!([key])
        );
        let snapshot = b.db.clone();
        assert!(call(&mut b, &at, operation.clone()).is_ok(), "grant {key}");
        b.db = snapshot;
        assign(&mut b, &ot, "alice", "member");
        assert!(call(&mut b, &at, operation).is_err(), "revoked {key}");
    }
    // Rename permission alone cannot smuggle an avatar or role/owner change.
    let rev = b.db["groups"][0]["roles_revision"].clone();
    call(&mut b,&ot,json!({"op":"save_group_role","role":"admin","name":"Rename","permissions":["group.rename"],"revision":rev})).unwrap();
    assign(&mut b, &ot, "alice", "admin");
    let snapshot = b.db["groups"][0].clone();
    assert!(call(
        &mut b,
        &at,
        json!({"op":"update_group","name":"Changed","avatar":""})
    )
    .is_err());
    assert_eq!(b.db["groups"][0], snapshot);
    call(&mut b,&at,json!({"op":"update_group","name":"Allowed","owner":"alice","roles":[{"id":"admin","permissions":MANAGEMENT}],"memberRoles":{"alice":"admin"},"permissions":MANAGEMENT})).unwrap();
    assert_eq!(b.db["groups"][0]["owner"], snapshot["owner"]);
    assert_eq!(b.db["groups"][0]["roles"], snapshot["roles"]);
    assert!(call(
        &mut b,
        &ot,
        json!({"op":"create_channel","kind":"invalid","name":"Bad"})
    )
    .is_err());
}
#[test]
fn kick_leave_voice_cleanup_protected_targets_and_moderation_boundaries() {
    let (mut b, ot, at, bt) = fixture();
    // Baseline invite permission must not turn ordinary targets into protected admins.
    b.db["groups"][0]["member_invites"] = json!(true);
    assign(&mut b, &ot, "alice", "admin");
    let g = b.db["groups"][0].clone();
    let owner = g["owner"].clone();
    let room = arr(&g["channels"])
        .iter()
        .find(|c| c["kind"] == "voice")
        .unwrap()["id"]
        .clone();
    let client = id();
    call(
        &mut b,
        &bt,
        json!({"op":"voice_join","room":room,"client":client}),
    )
    .unwrap();
    b.signals
        .push(json!({"from":client,"target":"other","time":now()}));
    assert!(call(&mut b, &at, json!({"op":"kick_group_member","user":owner})).is_err());
    assert!(call(
        &mut b,
        &at,
        json!({"op":"kick_group_member","user":"alice"})
    )
    .is_err());
    let bot = call(
        &mut b,
        &ot,
        json!({"op":"create_bot","name":"Bot","username":"rbacbot"}),
    )
    .unwrap();
    assert!(call(
        &mut b,
        &ot,
        json!({"op":"set_group_member_role","user":bot["bot"]["id"],"role":"admin","revision":1})
    )
    .is_err());
    assert!(call(
        &mut b,
        &at,
        json!({"op":"kick_group_member","user":bot["bot"]["id"]})
    )
    .is_err());
    assign(&mut b, &ot, "bob", "admin");
    assert!(call(&mut b, &at, json!({"op":"kick_group_member","user":"bob"})).is_err());
    assign(&mut b, &ot, "bob", "member");
    call(&mut b, &at, json!({"op":"kick_group_member","user":"bob"})).unwrap();
    assert!(b.voice.is_empty());
    assert!(b.signals.is_empty());
    assert!(!arr(&b.db["groups"][0]["members"]).contains(&json!("bob")));
    assert!(b.db["groups"][0]["memberRoles"].get("bob").is_none());
    assert!(call(
        &mut b,
        &bt,
        json!({"op":"voice_join","room":room,"client":client})
    )
    .is_err());
    let dm = call(
        &mut b,
        &ot,
        json!({"op":"create_dialog","members":["alice"]}),
    )
    .unwrap();
    b.db["messages"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"dm","channel":dm["id"],"user":"alice","text":"Private"}));
    assert!(call(
        &mut b,
        &ot,
        json!({"op":"delete_message","message":"dm","for_everyone":true})
    )
    .is_err());
    assert!(call(
        &mut b,
        &ot,
        json!({"op":"update_message","message":"dm","text":"Changed"})
    )
    .is_err());
    call(&mut b, &ot, json!({"op":"delete_message","message":"dm"})).unwrap();
    assert_eq!(b.db["messages"][0]["hidden_by"], json!([owner]));
    assert!(call(&mut b, &ot, json!({"op":"leave_group"})).is_err());
    call(&mut b, &at, json!({"op":"leave_group"})).unwrap();
    assert!(call(&mut b, &at, json!({"op":"update_group","name":"Denied"})).is_err());
}
#[test]
fn bots_scoped_install_remove_never_expose_other_owner_credentials() {
    let (mut b, ot, at, _) = fixture();
    let bot = call(
        &mut b,
        &ot,
        json!({"op":"create_bot","name":"Bot","username":"credentialbot"}),
    )
    .unwrap();
    assign(&mut b, &ot, "alice", "admin");
    for op in ["bot_rotate_token", "bot_set_commands"] {
        assert!(call(
            &mut b,
            &at,
            json!({"op":op,"bot":bot["bot"]["id"],"commands":["help"]})
        )
        .is_err());
    }
    let other = call(&mut b, &at, json!({"op":"create_group","name":"Other"})).unwrap();
    call(
        &mut b,
        &at,
        json!({"op":"add_bot_to_group","group":other["id"],"bot":bot["bot"]["id"]}),
    )
    .unwrap();
    call(
        &mut b,
        &at,
        json!({"op":"delete_bot","bot":bot["bot"]["id"]}),
    )
    .unwrap();
    assert!(b.db["bots"][0]["enabled"] != false);
    assert_eq!(b.db["bots"][0]["groups"], json!([other["id"]]));
    assert!(call(
        &mut b,
        &at,
        json!({"op":"delete_bot","bot":bot["bot"]["id"]})
    )
    .is_err());
    let mut global = json!({"op":"delete_bot","bot":bot["bot"]["id"],"token":at});
    assert!(b.request(global.clone()).is_err());
    global["token"] = json!(ot);
    b.request(global).unwrap();
    assert_eq!(b.db["bots"][0]["enabled"], false);
}

#[test]
fn member_invite_policy_strict_owner_union_rotation_and_persistence() {
    let (mut b, ot, at, bt) = fixture();
    // Simulate a persisted pre-policy group. Migration defaults false without rotating.
    b.db["groups"][0]
        .as_object_mut()
        .unwrap()
        .remove("member_invites");
    b.save().unwrap();
    let raw_invite = b.db["groups"][0]["invite"].clone();
    let reopened = Backend::open(b.path.clone()).unwrap();
    assert_eq!(reopened.db["groups"][0]["member_invites"], false);
    assert_eq!(reopened.db["groups"][0]["invite"], raw_invite);
    drop(reopened);
    let legacy = b.db["groups"][0].clone();
    assert_eq!(b.group_dto(&legacy, "alice")["membersCanInvite"], false);
    assert_eq!(b.group_dto(&legacy, "alice")["invite"], "");
    assert!(call(
        &mut b,
        &at,
        json!({"op":"invite_group_member","email":"bob@test.local"})
    )
    .is_err());
    for enabled in [json!(null), json!(0), json!("true"), json!([]), json!({})] {
        let before = b.db.clone();
        assert!(call(
            &mut b,
            &ot,
            json!({"op":"set_group_member_invites","enabled":enabled,"revision":0})
        )
        .is_err());
        assert_eq!(b.db, before);
    }
    for revision in [json!(null), json!(-1), json!(0.5), json!("0"), json!(9)] {
        let before = b.db.clone();
        assert!(call(
            &mut b,
            &ot,
            json!({"op":"set_group_member_invites","enabled":true,"revision":revision})
        )
        .is_err());
        assert_eq!(b.db, before);
    }
    assign(&mut b, &ot, "alice", "admin");
    let before = b.db.clone();
    assert!(call(
        &mut b,
        &at,
        json!({"op":"set_group_member_invites","enabled":true,"revision":1})
    )
    .is_err());
    assert_eq!(b.db, before);
    let enabled = call(
        &mut b,
        &ot,
        json!({"op":"set_group_member_invites","enabled":true,"revision":1}),
    )
    .unwrap();
    assert_eq!(enabled["rolesRevision"], 2);
    assert_eq!(enabled["roles"][0]["permissions"], json!([]));
    assert!(enabled.get("member_invites").is_none());
    b.db["users"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"newhuman","name":"New human","email":"new@test.local"}));
    call(
        &mut b,
        &bt,
        json!({"op":"invite_group_member","email":"new@test.local"}),
    )
    .unwrap();
    assert!(arr(&b.db["groups"][0]["members"]).contains(&json!("newhuman")));
    let dto = b.group_dto(&b.db["groups"][0], "bob");
    assert_eq!(dto["permissions"], json!(["members.invite"]));
    assert_eq!(dto["invite"], enabled["invite"]);
    call(
        &mut b,
        &bt,
        json!({"op":"invite_group_member","email":"bob@test.local"}),
    )
    .unwrap();
    let persisted = Backend::open(b.path.clone()).unwrap();
    assert_eq!(
        persisted.group_dto(&persisted.db["groups"][0], "bob")["membersCanInvite"],
        true
    );
    assert_eq!(
        persisted.group_dto(&persisted.db["groups"][0], "bob")["invite"],
        enabled["invite"]
    );
    drop(persisted);
    let bot = call(
        &mut b,
        &ot,
        json!({"op":"create_bot","name":"Bot","username":"policybot"}),
    )
    .unwrap();
    assert_eq!(
        b.group_dto(&b.db["groups"][0], s(&bot["bot"], "id"))["permissions"],
        json!([])
    );
    assert!(call(
        &mut b,
        s(&bot, "token"),
        json!({"op":"set_group_member_invites","enabled":false,"revision":2})
    )
    .is_err());
    call(
        &mut b,
        &ot,
        json!({"op":"update_group","name":"Safe","member_invites":false,"membersCanInvite":false}),
    )
    .unwrap();
    assert_eq!(b.db["groups"][0]["member_invites"], true);
    // A failed atomic save must roll back policy, invite and revision together.
    let snapshot = b.db.clone();
    std::fs::create_dir(b.path.with_extension("tmp")).unwrap();
    assert!(call(
        &mut b,
        &ot,
        json!({"op":"set_group_member_invites","enabled":false,"revision":2})
    )
    .is_err());
    assert_eq!(b.db, snapshot);
    std::fs::remove_dir(b.path.with_extension("tmp")).unwrap();
    let disabled = call(
        &mut b,
        &ot,
        json!({"op":"set_group_member_invites","enabled":false,"revision":2}),
    )
    .unwrap();
    assert_ne!(disabled["invite"], enabled["invite"]);
    assert!(uuid::Uuid::parse_str(s(&disabled, "invite")).is_ok());
    assert_eq!(b.group_dto(&b.db["groups"][0], "bob")["invite"], "");
    assert_eq!(
        b.group_dto(&b.db["groups"][0], "alice")["invite"],
        disabled["invite"]
    );
    assert!(call(
        &mut b,
        &bt,
        json!({"op":"invite_group_member","email":"bob@test.local"})
    )
    .is_err());
    assert!(call(
        &mut b,
        &bt,
        json!({"op":"join_group","invite":enabled["invite"]})
    )
    .is_err());
    let outsider = json!({"id":"outsider","name":"Outsider"});
    b.db["users"].as_array_mut().unwrap().push(outsider.clone());
    let outsider_token = b.token(&outsider, "test", false).unwrap();
    let guest_join = call(
        &mut b,
        &outsider_token,
        json!({"op":"join_group","invite":disabled["invite"]}),
    )
    .unwrap();
    assert_eq!(guest_join["invite"], "");
    assert_eq!(guest_join["membersCanInvite"], false);
    let joined = call(
        &mut b,
        &bt,
        json!({"op":"join_group","invite":disabled["invite"]}),
    )
    .unwrap();
    assert_eq!(joined["invite"], "");
    let repeated = call(
        &mut b,
        &ot,
        json!({"op":"set_group_member_invites","enabled":false,"revision":3}),
    )
    .unwrap();
    assert_eq!(repeated["invite"], disabled["invite"]);
    let role=call(&mut b,&ot,json!({"op":"save_group_role","name":"Inviter","permissions":["members.invite"],"revision":4})).unwrap();
    let rid = role["roles"].as_array().unwrap().last().unwrap()["id"].clone();
    assign(&mut b, &ot, "bob", rid.as_str().unwrap());
    call(
        &mut b,
        &bt,
        json!({"op":"invite_group_member","email":"bob@test.local"}),
    )
    .unwrap();
    assert_eq!(
        b.group_dto(&b.db["groups"][0], "bob")["invite"],
        disabled["invite"]
    );
    let other = call(&mut b, &at, json!({"op":"create_group","name":"Other"})).unwrap();
    assert!(call(
        &mut b,
        &ot,
        json!({"op":"set_group_member_invites","group":other["id"],"enabled":true,"revision":0})
    )
    .is_err());
    let path = b.path.clone();
    drop(b);
    let b = Backend::open(path).unwrap();
    let dto = b.group_dto(&b.db["groups"][0], "bob");
    assert_eq!(dto["membersCanInvite"], false);
    assert_eq!(dto["invite"], disabled["invite"]);
    assert_eq!(dto["rolesRevision"], 6);
}

#[tokio::test]
async fn member_invite_policy_real_http_cookie_auth_and_dto_redaction() {
    let (b, ot, at, bt) = fixture();
    let gid = b.db["groups"][0]["id"].clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, api_router(b)).await.unwrap() });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let policy = json!({"op":"set_group_member_invites","group":gid,"enabled":true,"revision":0});
    assert_eq!(
        client
            .post(&url)
            .json(&policy)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let post = |token: String, body: Value| {
        client
            .post(&url)
            .header("cookie", format!("mines_session={token}"))
            .json(&body)
            .send()
    };
    assert_eq!(
        post(at.clone(), policy.clone()).await.unwrap().status(),
        400
    );
    let state: Value = post(at.clone(), json!({"op":"state"}))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(state["data"]["groups"][0]["invite"], "");
    assert_eq!(
        post(
            ot.clone(),
            json!({"op":"set_group_member_invites","group":gid,"enabled":"true","revision":0})
        )
        .await
        .unwrap()
        .status(),
        400
    );
    let enabled: Value = post(ot.clone(), policy.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(enabled["data"]["membersCanInvite"], true);
    assert_eq!(post(ot.clone(), policy).await.unwrap().status(), 400);
    let state: Value = post(at.clone(), json!({"op":"state"}))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        state["data"]["groups"][0]["invite"],
        enabled["data"]["invite"]
    );
    assert_eq!(
        post(
            at.clone(),
            json!({"op":"invite_group_member","group":gid,"email":"bob@test.local"})
        )
        .await
        .unwrap()
        .status(),
        200
    );
    let disabled: Value = post(
        ot,
        json!({"op":"set_group_member_invites","group":gid,"enabled":false,"revision":1}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_ne!(disabled["data"]["invite"], enabled["data"]["invite"]);
    assert_eq!(
        post(
            at.clone(),
            json!({"op":"invite_group_member","group":gid,"email":"bob@test.local"})
        )
        .await
        .unwrap()
        .status(),
        400
    );
    assert_eq!(
        post(
            bt,
            json!({"op":"join_group","invite":enabled["data"]["invite"]})
        )
        .await
        .unwrap()
        .status(),
        400
    );
    let state: Value = post(at, json!({"op":"state"}))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(state["data"]["groups"][0]["invite"], "");
    server.abort();
}
