use super::*;

struct Fixture {
    b: Backend,
    owner: Value,
    owner_token: String,
    outsider_token: String,
    channel: String,
}

impl Fixture {
    /// Группа с одним текстовым каналом; 120 сообщений пишутся напрямую в базу,
    /// чтобы тест не тратил время на сто двадцать запросов.
    fn with_history(count: usize) -> Self {
        let path = std::env::temp_dir()
            .join(format!("sombra-history-{}", id()))
            .join("db.json");
        let mut b = Backend::open(path).unwrap();
        let owner = b.db["users"][0].clone();
        let owner_token = b.token(&owner, "one", false).unwrap();
        let outsider = b.new_user("Outsider", "outsider@example.test", "password123");
        b.db["users"].as_array_mut().unwrap().push(outsider.clone());
        let outsider_token = b.token(&outsider, "two", false).unwrap();
        let channel = id();
        b.db["groups"] = json!([{
            "id": id(),
            "owner": owner["id"],
            "members": [owner["id"]],
            "channels": [{"id": channel, "name": "общий", "kind": "text"}]
        }]);
        for index in 0..count {
            b.db["messages"].as_array_mut().unwrap().push(json!({
                "id": format!("m{index:04}"),
                "channel": channel,
                "user": owner["id"],
                "text": format!("сообщение {index}"),
                "time": 1_700_000_000.0 + index as f64
            }));
        }
        b.save().unwrap();
        Self {
            b,
            owner,
            owner_token,
            outsider_token,
            channel,
        }
    }

    fn page(&mut self, body: Value) -> Result<Value, String> {
        let mut request =
            json!({"op":"messages_page","token":self.owner_token,"channel":self.channel});
        request
            .as_object_mut()
            .unwrap()
            .extend(body.as_object().unwrap().clone());
        self.b.request(request)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.b.path.parent().unwrap());
    }
}

#[test]
fn snapshot_keeps_only_last_page_of_each_channel() {
    let mut f = Fixture::with_history(120);
    let state = f.b.state(&f.owner, false);
    let messages = state["messages"].as_array().unwrap();
    assert_eq!(messages.len(), STATE_PAGE);
    assert_eq!(messages[0]["text"], json!("сообщение 70"));
    assert_eq!(
        messages.last().unwrap()["text"],
        json!("сообщение 119"),
        "последняя страница заканчивается свежим сообщением"
    );
    assert_eq!(state["historyTruncated"], json!([f.channel.clone()]));
}

#[test]
fn short_history_is_not_truncated() {
    let mut f = Fixture::with_history(12);
    let state = f.b.state(&f.owner, false);
    assert_eq!(state["messages"].as_array().unwrap().len(), 12);
    assert_eq!(state["historyTruncated"], json!([]));
}

#[test]
fn pages_walk_backwards_from_cursor_until_start() {
    let mut f = Fixture::with_history(120);
    let first = f.page(json!({"limit":50})).unwrap();
    let messages = first["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 50);
    assert_eq!(
        messages[0]["text"],
        json!("сообщение 70"),
        "первая страница — самая свежая"
    );
    assert_eq!(messages.last().unwrap()["text"], json!("сообщение 119"));
    assert_eq!(first["hasMore"], json!(true));
    let cursor = first["nextBefore"].as_str().unwrap().to_owned();

    let second = f.page(json!({"before":cursor,"limit":50})).unwrap();
    assert_eq!(second["messages"].as_array().unwrap().len(), 50);
    assert_eq!(
        second["messages"].as_array().unwrap()[0]["text"],
        json!("сообщение 20")
    );
    assert_eq!(
        second["messages"].as_array().unwrap()[49]["text"],
        json!("сообщение 69")
    );
    assert_eq!(second["hasMore"], json!(true));

    let cursor = second["nextBefore"].as_str().unwrap().to_owned();
    let third = f.page(json!({"before":cursor,"limit":50})).unwrap();
    assert_eq!(third["messages"].as_array().unwrap().len(), 20);
    assert_eq!(
        third["messages"].as_array().unwrap()[0]["text"],
        json!("сообщение 0")
    );
    assert_eq!(third["hasMore"], json!(false));
    assert_eq!(third["nextBefore"], Value::Null);
}

#[test]
fn unknown_cursor_is_rejected_instead_of_guessing() {
    let mut f = Fixture::with_history(5);
    let error = f.page(json!({"before":"нет-такого"})).unwrap_err();
    assert_eq!(error, "HISTORY_CURSOR_INVALID");
}

#[test]
fn limit_is_clamped_and_default_applies() {
    let mut f = Fixture::with_history(150);
    let clamped = f.page(json!({"limit":500})).unwrap();
    assert_eq!(
        clamped["messages"].as_array().unwrap().len(),
        HISTORY_LIMIT_MAX
    );
    let default = f.page(json!({})).unwrap();
    assert_eq!(
        default["messages"].as_array().unwrap().len(),
        HISTORY_LIMIT_DEFAULT
    );
    let smallest = f.page(json!({"limit":0})).unwrap();
    assert_eq!(smallest["messages"].as_array().unwrap().len(), 1);
}

#[test]
fn outsiders_cannot_read_history() {
    let mut f = Fixture::with_history(5);
    let error =
        f.b.request(json!({"op":"messages_page","token":f.outsider_token,"channel":f.channel}))
            .unwrap_err();
    assert_eq!(error, "Нет доступа к чату");
}

#[test]
fn reply_preview_resolves_across_page_boundary() {
    let mut f = Fixture::with_history(60);
    // Ответ на самое старое сообщение, которое в снапшот уже не попадает.
    f.b.db["messages"].as_array_mut().unwrap().push(json!({
        "id": "reply-1",
        "channel": f.channel,
        "user": f.owner["id"],
        "text": "ответ",
        "time": 1_700_000_100.0,
        "reply_to": "m0000"
    }));
    let page = f.page(json!({"limit":10})).unwrap();
    let last = page["messages"].as_array().unwrap().last().unwrap();
    assert_eq!(last["replyTo"]["id"], json!("m0000"));
    assert_eq!(last["replyTo"]["text"], json!("сообщение 0"));
}
