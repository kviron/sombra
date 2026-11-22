use super::*;

struct Fixture {
    b: Backend,
    a: Value,
    guest: Value,
    at: String,
    gt: String,
    source: String,
    target: String,
    private: String,
}

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir()
            .join(format!("sombra-references-{}", id()))
            .join("db.json");
        let mut b = Backend::open(path).unwrap();
        let a = b.db["users"][0].clone();
        let guest = b.new_user("Guest", "guest@example.test", "password123");
        b.db["users"].as_array_mut().unwrap().push(guest.clone());
        let at = b.token(&a, "one", false).unwrap();
        let gt = b.token(&guest, "two", false).unwrap();
        let source = id();
        let target = id();
        let private = id();
        b.db["dialogs"] = json!([{"id":source,"members":[a["id"],guest["id"]]}]);
        b.db["groups"] = json!([{"id":id(),"owner":a["id"],"members":[a["id"],guest["id"]],"channels":[{"id":target,"type":"text"}]},{"id":id(),"owner":a["id"],"members":[a["id"]],"channels":[{"id":private,"type":"voice"}]}]);
        b.save().unwrap();
        Self {
            b,
            a,
            guest,
            at,
            gt,
            source,
            target,
            private,
        }
    }
    fn send(&mut self, channel: String, extra: Value) -> String {
        let mut message =
            json!({"op":"message","token":self.at,"channel":channel,"text":"original"});
        message
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        self.b.request(message).unwrap();
        s(
            self.b.db["messages"].as_array().unwrap().last().unwrap(),
            "id",
        )
        .to_owned()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.b.path.parent().unwrap());
    }
}

#[test]
fn reply_previews_are_same_channel_per_viewer_and_live() {
    let mut f = Fixture::new();
    let source = f.send(
        f.source.clone(),
        json!({"text":"🙂".repeat(215),"attachment":{"name":"private.txt","data":"YQ=="}}),
    );
    assert_eq!(
        f.b.state(&f.a, false)["features"]["messageReferences"],
        true
    );
    let reply = f.send(f.source.clone(), json!({"replyTo":source,"text":"reply"}));
    let dto = f.b.state(&f.guest, false)["messages"][1].clone();
    assert_eq!(
        dto["replyTo"],
        json!({"id":source,"author":f.a["id"],"text":"🙂".repeat(200)})
    );
    assert!(dto.get("reply_to").is_none());
    assert_eq!(
        f.b.request(
            json!({"op":"message","token":f.gt,"channel":f.target,"text":"x","replyTo":source})
        )
        .unwrap_err(),
        UNAVAILABLE
    );
    assert_eq!(
        f.b.request(
            json!({"op":"message","token":f.gt,"channel":f.source,"text":"x","replyTo":null})
        )
        .unwrap_err(),
        UNAVAILABLE
    );
    f.b.request(json!({"op":"update_message","token":f.at,"message":source,"text":"edited"}))
        .unwrap();
    assert_eq!(
        f.b.state(&f.guest, false)["messages"][1]["replyTo"]["text"],
        "edited"
    );
    f.b.request(json!({"op":"delete_message","token":f.gt,"message":source}))
        .unwrap();
    let dto = f.b.state(&f.guest, false)["messages"][0].clone();
    assert_eq!(dto["id"], reply);
    assert_eq!(dto["replyTo"], json!({"id":source}));
    assert_eq!(
        f.b.request(
            json!({"op":"message","token":f.gt,"channel":f.source,"text":"x","replyTo":source})
        )
        .unwrap_err(),
        UNAVAILABLE
    );
    assert_eq!(
        f.b.state(&f.a, false)["messages"][1]["replyTo"]["text"],
        "edited"
    );
    f.b.request(json!({"op":"delete_message","token":f.at,"message":source,"for_everyone":true}))
        .unwrap();
    assert_eq!(
        f.b.state(&f.a, false)["messages"][0]["replyTo"],
        json!({"id":source})
    );
}

#[test]
fn forwards_are_authorized_text_only_independent_and_atomic() {
    let mut f = Fixture::new();
    let source = f.send(f.source.clone(), json!({}));
    let private = f.send(f.private.clone(), json!({}));
    let media = f.send(
        f.source.clone(),
        json!({"attachment":{"name":"private.txt","data":"YQ=="}}),
    );
    let forward = |token: &str, message: &str, channel: &str, comment: Value| json!({"op":"forward_message","token":token,"message":message,"channel":channel,"comment":comment});
    assert_eq!(
        f.b.request(forward(&f.gt, &private, &f.target, json!("x")))
            .unwrap_err(),
        UNAVAILABLE
    );
    assert_eq!(
        f.b.request(forward(&f.gt, &source, &f.private, json!("x")))
            .unwrap_err(),
        "MESSAGE_FORWARD_TARGET_UNAVAILABLE"
    );
    assert_eq!(
        f.b.request(forward(&f.gt, &media, &f.target, json!("x")))
            .unwrap_err(),
        "MESSAGE_FORWARD_MEDIA_UNSUPPORTED"
    );
    for comment in [json!(5), json!("x".repeat(2001))] {
        assert_eq!(
            f.b.request(forward(&f.gt, &source, &f.target, comment))
                .unwrap_err(),
            INVALID
        );
    }
    let before = f.b.db["messages"].clone();
    let temp = f.b.path.with_extension("tmp");
    std::fs::create_dir(&temp).unwrap();
    assert_eq!(
        f.b.request(forward(&f.gt, &source, &f.target, json!("comment")))
            .unwrap_err(),
        "STORAGE_UNAVAILABLE"
    );
    assert_eq!(f.b.db["messages"], before);
    std::fs::remove_dir(&temp).unwrap();
    assert_eq!(
        Backend::open(f.b.path.clone()).unwrap().db["messages"],
        before
    );
    let messages =
        f.b.request(forward(&f.gt, &source, &f.target, json!(" comment ")))
            .unwrap()["messages"]
            .clone();
    assert_eq!(messages[0]["text"], "original");
    assert_eq!(messages[0]["forwardedFrom"], json!({"author":f.a["id"]}));
    assert_eq!(messages[0]["user"], f.guest["id"]);
    assert_ne!(messages[0]["id"], source);
    assert!(messages[0].get("forwarded_author").is_none());
    assert_eq!(messages[1]["text"], "comment");
    assert!(messages[1].get("forwardedFrom").is_none());
    assert_eq!(
        f.b.request(
            json!({"op":"update_message","token":f.gt,"message":messages[0]["id"],"text":"forged"})
        )
        .unwrap_err(),
        "MESSAGE_FORWARD_IMMUTABLE"
    );
    let reopened = Backend::open(f.b.path.clone()).unwrap();
    let state = reopened.state(&f.guest, false);
    assert_eq!(state["messages"][2]["id"], messages[0]["id"]);
    assert_eq!(state["messages"][3]["id"], messages[1]["id"]);
    f.b.request(json!({"op":"delete_message","token":f.gt,"message":source}))
        .unwrap();
    assert_eq!(
        f.b.request(forward(&f.gt, &source, &f.target, json!("")))
            .unwrap_err(),
        UNAVAILABLE
    );
    assert_eq!(
        f.b.state(&f.guest, false)["messages"][1]["text"],
        "original"
    );
}
