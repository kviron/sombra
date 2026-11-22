use super::*;

#[tokio::test]
async fn human_typing_http_cookie_actor_and_normalizer() {
    let (b,a,p,_) = fixture();
    let path = b.path.clone();
    let disk = std::fs::read(&path).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api",listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, api_router(b)).await.unwrap() });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::new();
    for authorization in [None,Some("Bearer bogus")] {
        let mut request=client.post(&url).json(&json!({"op":"set_typing","token":a,"channel":"dm","active":true}));
        if let Some(header)=authorization {request=request.header("authorization",header);}
        assert_eq!(request.send().await.unwrap().status(),401);
    }
    let response=client.post(&url).header("cookie",format!("mines_session={a}"))
        .json(&json!({"op":"set_typing","channel":"dm","active":true})).send().await.unwrap();
    assert_eq!(response.status(),200);
    assert_eq!(std::fs::read(&path).unwrap(),disk);
    let state:Value=client.post(&url).header("cookie",format!("mines_session={p}"))
        .json(&json!({"op":"state"})).send().await.unwrap().json().await.unwrap();
    assert_eq!(state["data"]["humanTyping"].as_array().unwrap().len(),1);
    server.abort();
    let _=server.await;
}

fn fixture() -> (Backend, String, String, String) {
    let mut b = Backend::open(std::env::temp_dir().join(id()).join("db.json")).unwrap();
    let owner = b.db["users"][0].clone();
    let peer = json!({"id":id(),"name":"Peer","created_at":now()});
    b.db["users"].as_array_mut().unwrap().push(peer.clone());
    let a = b.token(&owner, "typing", false).unwrap();
    let p = b.token(&peer, "typing", false).unwrap();
    b.db["dialogs"] = json!([{"id":"dm","members":[owner["id"],peer["id"]]}, {"id":"dm2","members":[owner["id"],peer["id"]]}]);
    b.save().unwrap();
    (b, a, p, s(&owner,"id").to_owned())
}
fn set(b: &mut Backend, token: &str, channel: &str, active: bool) -> Result<Value,String> {
    b.request(json!({"op":"set_typing","token":token,"bot_token":"","channel":channel,"active":active}))
}

#[test]
fn human_typing_ephemeral_strict_peer_ttl_and_restart() {
    let (mut b,a,p,uid) = fixture();
    // Even an unnormalized legacy snapshot must not be migrated by this operation.
    b.db.as_object_mut().unwrap().remove("read_state");
    let before = b.db.clone();
    let disk = std::fs::read(&b.path).unwrap();
    set(&mut b,&a,"dm",true).unwrap();
    assert_eq!(b.db,before);
    assert_eq!(std::fs::read(&b.path).unwrap(),disk);
    assert!(b.visible_human_typing(&uid).is_empty());
    let peer = b.authenticate(&p).unwrap();
    let visible = b.visible_human_typing(s(&peer,"id"));
    assert_eq!(visible.len(),1);
    assert_eq!(visible[0]["user"],uid);
    assert!(visible[0]["until"].as_u64().unwrap() > now());
    b.human_typing.get_mut(&uid).unwrap().1 = now();
    assert!(b.visible_human_typing(s(&peer,"id")).is_empty());
    set(&mut b,&a,"dm",true).unwrap();
    set(&mut b,&a,"dm2",true).unwrap();
    set(&mut b,&a,"dm",false).unwrap();
    assert_eq!(b.human_typing.len(),1);
    assert_eq!(b.human_typing[&uid].0,"dm2");
    set(&mut b,&p,"dm2",false).unwrap();
    assert_eq!(b.human_typing.len(),1);
    set(&mut b,&a,"dm2",false).unwrap();
    assert!(b.human_typing.is_empty());
    set(&mut b,&a,"dm",true).unwrap();
    assert!(Backend::open(b.path.clone()).unwrap().human_typing.is_empty());
    for request in [json!({"op":"set_typing","token":a,"channel":"dm","active":"true"}),json!({"op":"set_typing","token":a,"channel":3,"active":true}),json!({"op":"set_typing","token":a,"channel":"dm","active":true,"text":"draft"}),json!({"op":"set_typing","bot_token":"bearer","channel":"dm","active":true})] {
        assert!(b.request(request).is_err());
    }
}

#[test]
fn human_typing_current_acl_send_and_logout() {
    let (mut b,a,p,uid) = fixture();
    let peer = b.authenticate(&p).unwrap();
    set(&mut b,&a,"dm",true).unwrap();
    b.db["dialogs"][0]["members"] = json!([uid]);
    assert!(b.visible_human_typing(s(&peer,"id")).is_empty());
    assert!(set(&mut b,&a,"dm",true).is_err());
    b.db["dialogs"][0]["members"] = json!([uid,peer["id"],"third"]);
    assert!(set(&mut b,&a,"dm",true).is_err());
    b.db["dialogs"][0]["members"] = json!([uid,peer["id"]]);
    b.db["users"][1]["bot"] = json!(true);
    assert!(b.visible_human_typing(s(&peer,"id")).is_empty());
    assert!(set(&mut b,&a,"dm",true).is_err());
    b.db["users"][1]["bot"] = json!(false);
    assert!(set(&mut b,&a,"voice",true).is_err());
    b.request(json!({"op":"message","token":a,"channel":"dm","text":"sent"})).unwrap();
    assert!(b.human_typing.is_empty());
    set(&mut b,&a,"dm",true).unwrap();
    let state=b.request(json!({"op":"state","token":p})).unwrap();
    assert_eq!(state["humanTypingSupported"],true);
    assert_eq!(state["humanTyping"].as_array().unwrap().len(),1);
    b.request(json!({"op":"logout","token":a})).unwrap();
    assert!(b.human_typing.is_empty());
    assert!(set(&mut b,&a,"dm",true).is_err());
}
