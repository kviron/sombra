use super::*;

fn stage(b: &mut Backend, token: &str, channel: &Value, name: &str) -> Value {
    b.request(
        json!({"op":"upload_message_attachment","token":token,"channel":channel,
        "attachment":{"name":name,"data":STANDARD.encode(name)}}),
    )
    .unwrap()["id"]
        .clone()
}

#[test]
fn album_publication_is_ordered_idempotent_and_scoped_to_visible_messages() {
    let path = std::env::temp_dir().join(id()).join("db.json");
    let mut b = Backend::open(path.clone()).unwrap();
    let owner = b.db["users"][0].clone();
    let token = b.token(&owner, "test", false).unwrap();
    let group = b.db["groups"][0].clone();
    let channel = &group["channels"][0]["id"];
    let bot = b.request(json!({"op":"create_bot","token":token,"group":group["id"],"name":"Files","username":"files"})).unwrap();
    let first = stage(&mut b, &token, channel, "first");
    let second = stage(&mut b, &token, channel, "second");
    let state = json!({"op":"state","token":token});
    let snapshot = b.request(state.clone()).unwrap();
    assert_eq!(snapshot["features"]["messageAttachments"], true);
    assert!(!snapshot.to_string().contains(first.as_str().unwrap()));
    assert!(b.db["bot_updates"].as_array().unwrap().is_empty());
    b.request(json!({"op":"message","token":token,"channel":channel,"text":"original"}))
        .unwrap();
    let original = b.db["messages"][0]["id"].clone();
    let read = |message: &Value, attachment: &Value| json!({"op":"attachment_file","token":token,"message":message,"attachment_id":attachment,"with_attachment_id":true});
    assert!(b.request(read(&original, &first)).is_err());
    let publish = json!({"op":"message","token":token,"channel":channel,"text":"/ask files","attachment_ids":[second,first],"replyTo":original});

    // The same bytes stay private and retryable if committing the DB fails.
    std::fs::create_dir(path.with_extension("tmp")).unwrap();
    assert_eq!(
        b.request(publish.clone()).unwrap_err(),
        "STORAGE_UNAVAILABLE"
    );
    std::fs::remove_dir(path.with_extension("tmp")).unwrap();
    assert_eq!(b.db["messages"].as_array().unwrap().len(), 1);
    assert!(b.db["bot_updates"].as_array().unwrap().is_empty());
    drop(b);
    let mut b = Backend::open(path.clone()).unwrap();
    let result = b.request(publish.clone()).unwrap();
    let mid = &result["id"];
    assert!(mid.is_string());
    assert!(b.db["pending_attachments"].as_object().unwrap().is_empty());
    drop(b);
    let mut b = Backend::open(path.clone()).unwrap();
    assert_eq!(b.request(publish.clone()).unwrap(), result);
    assert_eq!(b.db["bot_updates"].as_array().unwrap().len(), 1);
    let snapshot = b.request(state.clone()).unwrap();
    let msg = &snapshot["messages"][1];
    assert_eq!(msg["attachments"][0]["id"], second);
    assert_eq!(msg["attachments"][1]["id"], first);
    assert_eq!(msg["attachment"], msg["attachments"][0]);
    assert_eq!(msg["replyTo"]["id"], original);
    assert!(!snapshot.to_string().contains("attachment_request_hash"));
    let page = b
        .request(json!({"op":"messages_page","token":token,"channel":channel}))
        .unwrap();
    assert_eq!(&page["messages"][1], msg);
    assert_eq!(
        b.request(read(mid, &first)).unwrap()["data"],
        STANDARD.encode("first")
    );
    assert_eq!(
        b.request(json!({"op":"attachment_file","token":token,"message":mid}))
            .unwrap()["name"],
        "second"
    );
    assert!(b.request(read(&original, &first)).is_err());
    let mut metadata = read(mid, &first);
    metadata["metadata_only"] = json!(true);
    let metadata = b.request(metadata).unwrap();
    assert_eq!(metadata["id"], first);
    assert!(metadata.get("data").is_none());
    let forward = json!({"op":"forward_message","token":token,"channel":channel,"message":mid});
    assert_eq!(
        b.request(forward).unwrap_err(),
        "MESSAGE_FORWARD_MEDIA_UNSUPPORTED"
    );

    let mut bot_read = json!({"op":"bot_attachment_file","bot_token":bot["token"],"update_id":1,"attachment_id":first});
    assert_eq!(
        b.request(bot_read.clone()).unwrap()["data"],
        STANDARD.encode("first")
    );
    bot_read["attachment_id"] = json!(id());
    assert_eq!(
        b.request(bot_read.clone()).unwrap_err(),
        "BOT_ATTACHMENT_UNAVAILABLE"
    );
    bot_read["attachment_id"] = first.clone();
    let file = b.attachment_path(&metadata).unwrap();
    std::fs::write(&file, b"other").unwrap();
    assert_eq!(
        b.request(bot_read.clone()).unwrap_err(),
        "BOT_ATTACHMENT_UNAVAILABLE"
    );
    std::fs::remove_file(file).unwrap();
    assert_eq!(b.request(read(mid, &first)).unwrap_err(), EXPIRED);
    let snapshot = b.request(state).unwrap();
    assert_eq!(snapshot["messages"][1]["attachments"][1]["expired"], true);
    assert_eq!(snapshot["messages"][1]["attachment"]["expired"], false);
    let mut conflict = publish.clone();
    conflict["attachment_ids"] = json!([first, second]);
    assert_eq!(
        b.request(conflict).unwrap_err(),
        "MESSAGE_ATTACHMENTS_CONFLICT"
    );
    let mut conflict = publish.clone();
    conflict["text"] = json!("other");
    assert_eq!(
        b.request(conflict).unwrap_err(),
        "MESSAGE_ATTACHMENTS_CONFLICT"
    );
    b.request(json!({"op":"update_message","token":token,"message":mid,"text":"edited"}))
        .unwrap();
    assert_eq!(b.request(publish).unwrap(), result);
    b.request(json!({"op":"delete_message","token":token,"message":mid,"for_everyone":true}))
        .unwrap();
    assert!(b.request(read(mid, &second)).is_err());
    assert_eq!(b.request(bot_read).unwrap_err(), "BOT_SOURCE_UNAVAILABLE");
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn album_ids_require_author_channel_permission_and_unexpired_uploads() {
    let path = std::env::temp_dir().join(id()).join("db.json");
    let mut b = Backend::open(path.clone()).unwrap();
    let owner = b.db["users"][0].clone();
    let token = b.token(&owner, "test", false).unwrap();
    let group = b.db["groups"][0].clone();
    let channel = &group["channels"][0]["id"];
    let guest = json!({"id":id(),"name":"Guest"});
    b.db["users"].as_array_mut().unwrap().push(guest.clone());
    let guest_token = b.token(&guest, "test", false).unwrap();
    let upload = json!({"op":"upload_message_attachment","token":guest_token,"channel":channel,"attachment":{"name":"photo","data":"YQ=="}});
    assert!(b.request(upload.clone()).is_err());
    b.request(json!({"op":"join_group","token":guest_token,"invite":group["invite"]}))
        .unwrap();
    let mut invalid_upload = upload.clone();
    invalid_upload["attachment"]["id"] = json!(id());
    assert_eq!(b.request(invalid_upload).unwrap_err(), INVALID);
    std::fs::create_dir(path.with_extension("tmp")).unwrap();
    assert_eq!(
        b.request(upload.clone()).unwrap_err(),
        "STORAGE_UNAVAILABLE"
    );
    std::fs::remove_dir(path.with_extension("tmp")).unwrap();
    assert_eq!(
        std::fs::read_dir(path.with_file_name("message-attachments"))
            .unwrap()
            .count(),
        0
    );
    let item = b.request(upload.clone()).unwrap()["id"].clone();
    let publish =
        json!({"op":"message","token":guest_token,"channel":channel,"attachment_ids":[item]});
    let mut request = publish.clone();
    request["token"] = json!(token);
    assert_eq!(b.request(request).unwrap_err(), UNAVAILABLE);
    let mut request = publish.clone();
    request["channel"] = group["channels"][1]["id"].clone();
    assert_eq!(b.request(request).unwrap_err(), UNAVAILABLE);
    for ids in [
        json!([]),
        json!([item, item]),
        json!([42]),
        json!({"id":item}),
        json!(["bad"]),
        json!(vec![id(); 11]),
    ] {
        let mut request = publish.clone();
        request["attachment_ids"] = ids;
        assert_eq!(b.request(request).unwrap_err(), INVALID);
    }
    for field in ["sticker", "attachments", "attachment", "attachment_id"] {
        let mut request = publish.clone();
        request[field] = json!({});
        assert_eq!(b.request(request).unwrap_err(), INVALID);
    }
    let mut request = publish.clone();
    request["attachment_ids"] = json!([item, id()]);
    assert_eq!(b.request(request).unwrap_err(), UNAVAILABLE);
    assert!(b.db["messages"].as_array().unwrap().is_empty());
    b.db["groups"][0]["members"]
        .as_array_mut()
        .unwrap()
        .retain(|u| *u != guest["id"]);
    assert_eq!(
        b.request(publish.clone()).unwrap_err(),
        "Нет доступа к чату"
    );
    b.db["groups"][0]["members"]
        .as_array_mut()
        .unwrap()
        .push(guest["id"].clone());
    let staged = &mut b.db["pending_attachments"][item.as_str().unwrap()];
    staged["expires_at"] = json!(now());
    let metadata = staged["attachment"].clone();
    let file = b.attachment_path(&metadata).unwrap();
    assert_eq!(b.request(publish).unwrap_err(), UNAVAILABLE);
    let ids: Vec<Value> = (0..MAX_ATTACHMENTS)
        .map(|i| stage(&mut b, &token, channel, &i.to_string()))
        .collect();
    b.cleanup_staged_attachments(now()).unwrap();
    assert!(!file.exists());
    let mid = b
        .request(json!({"op":"message","token":token,"channel":channel,"attachment_ids":ids}))
        .unwrap()["id"]
        .clone();
    let snapshot = b.request(json!({"op":"state","token":token})).unwrap();
    assert_eq!(snapshot["messages"][0]["text"], "");
    assert_eq!(
        snapshot["messages"][0]["attachments"]
            .as_array()
            .unwrap()
            .len(),
        MAX_ATTACHMENTS
    );
    b.request(json!({"op":"delete_message","token":guest_token,"message":mid}))
        .unwrap();
    assert!(b
        .request(
            json!({"op":"attachment_file","token":guest_token,"message":mid,"attachment_id":ids[1]})
        )
        .is_err());
    for _ in 0..MAX_PENDING_PER_USER {
        b.db["pending_attachments"][id()] =
            json!({"user":guest["id"],"expires_at":now()+STAGING_TTL});
    }
    assert_eq!(b.request(upload).unwrap_err(), "MESSAGE_ATTACHMENTS_LIMIT");
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
