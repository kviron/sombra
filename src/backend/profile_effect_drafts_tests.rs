use super::*;

struct Fixture {
    backend: Backend,
    token: Value,
    other: Value,
    bot: Value,
    foreign: Value,
}

impl Fixture {
    fn new() -> Self {
        let mut backend = Backend::open(std::env::temp_dir().join(id()).join("db.json")).unwrap();
        let owner = backend.db["users"][0].clone();
        let token = json!(backend.token(&owner, "draft test", false).unwrap());
        let other = backend.request(json!({"op":"register","name":"Member","email":"member@test.local","password":"strong-password"})).unwrap()["token"].clone();
        let group = backend.db["groups"][0]["id"].clone();
        let bot = backend.request(json!({"op":"create_bot","token":token,"group":group,"name":"Sombra","username":"sombra"})).unwrap()["token"].clone();
        let foreign = backend.request(json!({"op":"create_bot","token":token,"group":group,"name":"Elsewhere","username":"elsewhere"})).unwrap()["token"].clone();
        backend.profile_effect_draft_bot_id = Some(s(&backend.db["bots"][0], "id").to_string());
        Self {
            backend,
            token,
            other,
            bot,
            foreign,
        }
    }

    fn create(&mut self) -> Value {
        self.backend.request(json!({"op":CREATE,"token":self.token,"target":"avatar","prompt":" private prompt "})).unwrap()
    }

    fn claim(&mut self) -> Value {
        self.backend
            .request(json!({"op":CLAIM,"bot_token":self.bot}))
            .unwrap()["draft"]
            .clone()
    }

    fn finish(&self, draft: &Value) -> Value {
        json!({"op":FINISH,"bot_token":self.bot,"id":draft["id"],"lease":draft["lease"],
            "result":{"title":" Shield ","decoration":{"v":1,"target":"avatar","seed":19,
            "layers":[{"effect":"holy/divine-shield","anchor":"ring"}]}}})
    }
}

#[test]
fn private_owner_projection_persists_without_applying_or_enqueuing_chat() {
    let mut f = Fixture::new();
    let queued = f.create();
    assert_eq!(queued, json!({"id":queued["id"],"status":"queued"}));
    assert_eq!(
        f.backend
            .request(json!({"op":GET,"token":f.other,"id":queued["id"]}))
            .unwrap_err(),
        "PROFILE_EFFECT_DRAFT_NOT_FOUND"
    );
    assert_eq!(
        f.backend
            .request(json!({"op":CLAIM,"bot_token":f.foreign}))
            .unwrap_err(),
        "PROFILE_EFFECT_DRAFT_FORBIDDEN"
    );
    assert_eq!(
        f.backend
            .request(json!({"op":CLAIM,"token":f.token}))
            .unwrap_err(),
        "AUTH_REQUIRED"
    );
    assert_eq!(
        f.backend
            .request(json!({"op":GET,"bot_token":f.bot,"id":queued["id"]}))
            .unwrap_err(),
        "AUTH_REQUIRED"
    );
    let claim = f.claim();
    assert_eq!(
        claim,
        json!({"id":queued["id"],"target":"avatar","prompt":"private prompt","lease":claim["lease"]})
    );
    assert!(uuid::Uuid::parse_str(s(&claim, "lease")).is_ok());
    assert!(f.claim().is_null());
    assert_eq!(
        f.backend
            .request(json!({"op":GET,"token":f.token,"id":queued["id"]}))
            .unwrap(),
        json!({"id":queued["id"],"status":"running"})
    );
    let mut invalid = f.finish(&claim);
    invalid["result"]["decoration"]["url"] = json!("https://test.local");
    assert_eq!(f.backend.request(invalid).unwrap_err(), INVALID);
    let finish = f.finish(&claim);
    let ready = f.backend.request(finish.clone()).unwrap();
    assert_eq!(ready["status"], "ready");
    assert_eq!(ready["result"]["title"], "Shield");
    assert_eq!(f.backend.request(finish).unwrap_err(), CONFLICT);
    let mut reopened = Backend::open(f.backend.path.clone()).unwrap();
    assert_eq!(
        reopened
            .request(json!({"op":GET,"token":f.token,"id":queued["id"]}))
            .unwrap(),
        ready
    );
    assert!(reopened.db["users"][0]["decorations"].is_null());
    assert_eq!(reopened.db["messages"], json!([]));
    assert_eq!(reopened.db["bot_updates"], json!([]));
    for private in ["lease_hash", "worker_hash", "prompt"] {
        assert!(reopened.db[KEY][0].get(private).is_none());
    }
}

#[test]
fn enforces_attempt_expiry_retention_quota_and_disabled_lane() {
    let mut f = Fixture::new();
    let queued = f.create();
    f.create();
    let request = json!({"op":CREATE,"token":f.token,"target":"avatar","prompt":"third"});
    assert_eq!(
        f.backend.request(request.clone()).unwrap_err(),
        "PROFILE_EFFECT_DRAFT_LIMIT"
    );
    let original = f.claim();
    f.backend.db[KEY][0]["lease_until"] = json!(now());
    let finish = f.finish(&original);
    assert_eq!(f.backend.request(finish.clone()).unwrap_err(), CONFLICT);
    let renewed = f.claim();
    assert_eq!(original["id"], renewed["id"]);
    assert_ne!(original["lease"], renewed["lease"]);
    assert_eq!(f.backend.request(finish).unwrap_err(), CONFLICT);
    f.backend.db[KEY][0]["lease_until"] = json!(now());
    let read = json!({"op":GET,"token":f.token,"id":queued["id"]});
    assert_eq!(
        f.backend.request(read.clone()).unwrap(),
        json!({"id":queued["id"],"status":"failed","error":"expired"})
    );
    f.backend.request(request.clone()).unwrap();
    assert!(f.backend.db[KEY][0]["prompt"].is_null());
    f.backend.db[KEY][0]["retain_until"] = json!(now());
    assert_eq!(
        f.backend.request(read).unwrap_err(),
        "PROFILE_EFFECT_DRAFT_NOT_FOUND"
    );
    f.backend.profile_effect_draft_bot_id = None;
    assert_eq!(
        f.backend.request(request).unwrap_err(),
        "PROFILE_EFFECT_DRAFT_DISABLED"
    );
    assert_eq!(
        f.backend
            .request(json!({"op":CLAIM,"bot_token":f.bot}))
            .unwrap_err(),
        "PROFILE_EFFECT_DRAFT_FORBIDDEN"
    );
}

#[tokio::test]
async fn http_uses_cookie_and_bearer_and_does_not_cache_private_results() {
    let f = Fixture::new();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api", listener.local_addr().unwrap());
    let finish = f.finish(&json!({}));
    let server =
        tokio::spawn(async move { axum::serve(listener, api_router(f.backend)).await.unwrap() });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    let create = json!({"op":CREATE,"token":f.token,"target":"avatar","prompt":"private prompt"});
    assert_eq!(
        client
            .post(&url)
            .json(&create)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let cookie = format!("mines_session={}", f.token.as_str().unwrap());
    let response = client
        .post(&url)
        .header("cookie", &cookie)
        .json(&create)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let queued = response.json::<Value>().await.unwrap()["data"].clone();
    let response = client
        .post(&url)
        .bearer_auth(f.bot.as_str().unwrap())
        .json(&json!({"op":CLAIM}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let claimed = response.json::<Value>().await.unwrap()["data"]["draft"].clone();
    assert_eq!(claimed["id"], queued["id"]);
    let mut finish = finish;
    finish["id"] = claimed["id"].clone();
    finish["lease"] = json!(id());
    let response = client
        .post(&url)
        .bearer_auth(f.bot.as_str().unwrap())
        .json(&finish)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 409);
    finish["lease"] = claimed["lease"].clone();
    finish.as_object_mut().unwrap().remove("result");
    finish["error"] = json!("generation_failed");
    let response = client
        .post(&url)
        .bearer_auth(f.bot.as_str().unwrap())
        .json(&finish)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let response = client
        .post(&url)
        .header("cookie", &cookie)
        .json(&json!({"op":GET,"id":queued["id"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.json::<Value>().await.unwrap()["data"],
        json!({"id":queued["id"],"status":"failed","error":"generation_failed"})
    );
    server.abort();
}

#[test]
fn failed_database_save_rolls_back_draft_transitions() {
    let mut f = Fixture::new();
    let path = f.backend.path.clone();
    f.backend.path = path.join("not-a-directory.json");
    let create = json!({"op":CREATE,"token":f.token,"target":"avatar","prompt":"unpersisted"});
    assert_eq!(
        f.backend.request(create).unwrap_err(),
        "STORAGE_UNAVAILABLE"
    );
    assert_eq!(f.backend.db[KEY], json!([]));
    f.backend.path = path.clone();
    let queued = f.create();
    f.backend.path = path.join("not-a-directory.json");
    assert_eq!(
        f.backend
            .request(json!({"op":CLAIM,"bot_token":f.bot}))
            .unwrap_err(),
        "STORAGE_UNAVAILABLE"
    );
    assert_eq!(f.backend.db[KEY][0]["status"], "queued");
    f.backend.path = path.clone();
    let claim = f.claim();
    assert_eq!(claim["id"], queued["id"]);
    f.backend.path = path.join("not-a-directory.json");
    let finish = f.finish(&claim);
    assert_eq!(
        f.backend.request(finish.clone()).unwrap_err(),
        "STORAGE_UNAVAILABLE"
    );
    assert_eq!(f.backend.db[KEY][0]["status"], "running");
    f.backend.path = path;
    assert_eq!(f.backend.request(finish).unwrap()["status"], "ready");
}
