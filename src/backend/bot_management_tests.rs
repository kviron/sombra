use super::*;
fn fixture() -> (Backend, PathBuf, Value, Value) {
    let path = std::env::temp_dir().join(id()).join("db.json");
    let mut b = Backend::open(path.clone()).unwrap();
    let owner = b.db["users"][0].clone();
    let token = b.token(&owner, "test", false).unwrap();
    let bot=b.bot_management(&json!({"op":"create_bot","group":b.db["groups"][0]["id"],"name":"Helper","username":"helper"}),s(&owner,"id")).unwrap();
    (b, path, json!(token), bot)
}
fn send(b: &mut Backend, token: &Value, channel: &Value, text: &str) {
    b.request(json!({"op":"message","token":token,"channel":channel,"text":text}))
        .unwrap();
}
#[tokio::test]
async fn http_owner_settings_and_policy_use_cookie_actor_and_forbidden_status() {
    let (mut b,path,owner_token,bot)=fixture();
    let owner=b.db["users"][0]["id"].clone();let bid=bot["bot"]["id"].clone();
    let guest=json!({"id":id(),"name":"Other Admin","active":true});
    b.db["users"].as_array_mut().unwrap().push(guest.clone());
    let guest_token=b.token(&guest,"test",false).unwrap();
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url=format!("http://{}/api",listener.local_addr().unwrap());
    let server=tokio::spawn(async move {axum::serve(listener,api_router(b)).await.unwrap()});
    let _=rustls::crypto::ring::default_provider().install_default();
    let client=reqwest::Client::new();
    let owner_cookie=format!("mines_session={}",owner_token.as_str().unwrap());
    let guest_cookie=format!("mines_session={guest_token}");
    for op in ["get_bot_settings","get_bot_tool_users"] {
        let response=client.post(&url).header("cookie",&owner_cookie).json(&json!({"op":op,"bot":bid,"token":guest_token})).send().await.unwrap();
        assert_eq!(response.status(),200,"owner {op} must use cookie, not forged body token");
        assert_eq!(response.headers()["cache-control"],"no-store");
        let response=client.post(&url).header("cookie",&guest_cookie).json(&json!({"op":op,"bot":bid,"token":owner_token,"requester_id":owner,"user":owner,"owner":owner})).send().await.unwrap();
        assert_eq!(response.status(),403,"nonowner {op} must remain forbidden despite forged identity fields");
        let body:Value=response.json().await.unwrap();
        assert_eq!(body["error"],if op=="get_bot_settings"{"BOT_SETTINGS_FORBIDDEN"}else{"BOT_POLICY_FORBIDDEN"});
        let response=client.post(&url).json(&json!({"op":op,"bot":bid,"token":owner_token,"requester_id":owner})).send().await.unwrap();
        assert_eq!(response.status(),401,"body owner token is not a human cookie session");
        let response=client.post(&url).bearer_auth(bot["token"].as_str().unwrap()).json(&json!({"op":op,"bot":bid,"token":owner_token})).send().await.unwrap();
        assert_eq!(response.status(),401,"bot Bearer must not grant human owner API access");
    }
    for (op,patch,error) in [
        ("update_bot_settings",json!({"profile":{"bio":"Updated by actual owner"}}),"BOT_SETTINGS_FORBIDDEN"),
        ("set_bot_tool_users",json!({"users":[guest["id"]]}),"BOT_POLICY_FORBIDDEN")
    ] {
        let mut request=json!({"op":op,"bot":bid,"revision":0,"token":guest_token});
        for(key,value)in patch.as_object().unwrap(){request[key]=value.clone();}
        let response=client.post(&url).header("cookie",&owner_cookie).json(&request).send().await.unwrap();
        assert_eq!(response.status(),200,"actual owner {op} must succeed");
        let body:Value=response.json().await.unwrap();assert_eq!(body["data"]["revision"],1);
        request["revision"]=json!(1);request["token"]=owner_token.clone();request["requester_id"]=owner.clone();request["owner"]=owner.clone();
        let response=client.post(&url).header("cookie",&guest_cookie).json(&request).send().await.unwrap();
        assert_eq!(response.status(),403,"nonowner {op} must not become a grant holder via body spoofing or selected tool policy");
        let body:Value=response.json().await.unwrap();assert_eq!(body["error"],error);
    }
    server.abort();let _=server.await;
    let mut reopened=Backend::open(path.clone()).unwrap();let settings=reopened.request(json!({"op":"get_bot_settings","token":owner_token,"bot":bid})).unwrap();
    assert_eq!(settings["revision"],1);assert_eq!(settings["profile"]["bio"],"Updated by actual owner");
    assert_eq!(reopened.request(json!({"op":"get_bot_tool_users","token":owner_token,"bot":bid})).unwrap()["users"],json!([guest["id"]]));
    drop(reopened);std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn offline_configuration_uses_existing_owner_validators_without_credentials() {
    let (mut b, path, _token, _bot) = fixture();
    let before = b.db.clone();
    for patch in [
        json!({"conversation":{"mode":"all_history"}}),
        json!({"profile":{"avatar":"data:image/gif;base64,R0lGODlh"}}),
        json!({"revision":0,"profile":{"name":"Invalid"}}),
        json!({"owner":"forged","profile":{"name":"Invalid"}}),
    ] {
        assert!(b.configure_bot_offline("helper", &patch).is_err());
        assert_eq!(b.db, before);
    }
    assert!(b
        .configure_bot_offline("@helper", &json!({"profile":{"name":"Invalid"}}))
        .is_err());
    let result=b.configure_bot_offline("helper",&json!({"profile":{"name":"Сомбра"},"conversation":{"mode":"name_dialog","aliases":["Сомбра","Sombra"]}})).unwrap();
    assert_eq!(result["revision"], 1);
    assert_eq!(result["profile"]["name"], "Сомбра");
    assert_eq!(b.db["sessions"], before["sessions"]);
    assert_eq!(
        b.db["users"].as_array().unwrap().len(),
        before["users"].as_array().unwrap().len()
    );
    for field in ["owner", "username", "token_hash"] {
        assert_eq!(b.db["bots"][0][field], before["bots"][0][field]);
    }
    drop(b);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn zero_followups_membership_revocation_and_disabled_bots_do_not_capture(){
 let(mut b,path,token,bot)=fixture();let bid=bot["bot"]["id"].clone();let owner=b.db["users"][0]["id"].clone();let channel=b.db["groups"][0]["channels"][0]["id"].clone();
 b.request(json!({"op":"update_bot_settings","token":token,"bot":bid,"revision":0,"conversation":{"mode":"name_dialog","aliases":["Sombra"],"followupSeconds":0}})).unwrap();send(&mut b,&token,&channel,"Sombra hello");send(&mut b,&token,&channel,"private not followup");assert_eq!(arr(&b.db["bot_updates"]).len(),1);
 b.request(json!({"op":"update_bot_settings","token":token,"bot":bid,"revision":1,"conversation":{"followupSeconds":180,"followupMessages":0}})).unwrap();send(&mut b,&token,&channel,"Sombra hello");send(&mut b,&token,&channel,"still private");assert_eq!(arr(&b.db["bot_updates"]).len(),2);
 b.request(json!({"op":"update_bot_settings","token":token,"bot":bid,"revision":2,"conversation":{"followupMessages":1}})).unwrap();send(&mut b,&token,&channel,"Sombra start");assert_eq!(arr(&b.db["bots"][0]["followups"]).len(),1);
 let guest=json!({"id":id(),"name":"Guest","active":true});b.db["users"].as_array_mut().unwrap().push(guest.clone());let gt=json!(b.token(&guest,"test",false).unwrap());b.db["groups"][0]["members"].as_array_mut().unwrap().push(guest["id"].clone());b.db["groups"][0]["members"].as_array_mut().unwrap().retain(|u|u!=&owner);
 b.enqueue_bots(&json!({"id":id(),"user":owner,"channel":channel,"text":"Sombra removed actor"})).unwrap();assert_eq!(arr(&b.db["bot_updates"]).len(),3);send(&mut b,&gt,&channel,"other actor private");assert!(arr(&b.db["bots"][0]["followups"]).is_empty());
 b.db["groups"][0]["members"].as_array_mut().unwrap().push(owner);send(&mut b,&token,&channel,"no session after revoke");assert_eq!(arr(&b.db["bot_updates"]).len(),3);b.db["bots"][0]["enabled"]=json!(false);send(&mut b,&token,&channel,"Sombra disabled");assert_eq!(arr(&b.db["bot_updates"]).len(),3);
 drop(b);std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn owner_settings_profile_cas_and_transactional_rollback() {
    let (mut b, path, token, bot) = fixture();
    let bid = bot["bot"]["id"].clone();
    let owner = b.db["users"][0]["id"].clone();
    let get = json!({"op":"get_bot_settings","token":token,"bot":bid});
    let initial = b.request(get.clone()).unwrap();
    assert_eq!(initial["revision"], 0);
    assert_eq!(initial["bot"]["managementVersion"], 1);
    assert_eq!(initial["conversation"]["mode"], "addressed");
    assert!(initial["bot"]["followups"].is_null());
    let guest = json!({"id":id(),"name":"Admin","active":true});
    b.db["users"].as_array_mut().unwrap().push(guest.clone());
    let gt = b.token(&guest, "test", false).unwrap();
    let mut denied = get.clone();
    denied["token"] = json!(gt);
    assert_eq!(b.request(denied).unwrap_err(), "BOT_SETTINGS_FORBIDDEN");
    let avatar = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nfixture")
    );
    let update = json!({"op":"update_bot_settings","token":token,"bot":bid,"revision":0,"profile":{"name":"Сомбра","bio":"Scoped persona","avatar":avatar},"conversation":{"mode":"name_dialog","aliases":["Sombra","моя Сомбра"],"followupSeconds":180,"followupMessages":8,"reactions":true}});
    let saved = b.request(update.clone()).unwrap();
    assert_eq!(saved["revision"], 1);
    assert_eq!(saved["bot"]["name"], "Сомбра");
    assert_eq!(
        b.db["users"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["id"] == bid)
            .unwrap()["name"],
        "Сомбра"
    );
    assert_eq!(b.request(update).unwrap_err(), "BOT_SETTINGS_CONFLICT");
    for patch in [
        json!({"profile":{"username":"newname"}}),
        json!({"profile":{"bio":"x".repeat(513)}}),
        json!({"profile":{"avatar":"data:image/gif;base64,R0lGODlh"}}),
        json!({"conversation":{"followupSeconds":601}}),
        json!({"conversation":{"followupMessages":21}}),
        json!({"conversation":{"aliases":["Sombra","sombra"]}}),
        json!({"owner":guest["id"]}),
    ] {
        let mut v = json!({"op":"update_bot_settings","token":token,"bot":bid,"revision":1});
        for (k, val) in patch.as_object().unwrap() {
            v[k] = val.clone();
        }
        assert_eq!(b.request(v).unwrap_err(), "BOT_SETTINGS_INVALID");
    }
    let mut reopened = Backend::open(path.clone()).unwrap();
    assert_eq!(
        reopened.request(get.clone()).unwrap()["profile"]["avatar"],
        avatar
    );
    drop(reopened);
    let snapshot = b.db.clone();
    let old_path = b.path.clone();
    b.path = path.parent().unwrap().to_path_buf();
    assert!(b.request(json!({"op":"update_bot_settings","token":token,"bot":bid,"revision":1,"profile":{"name":"Failure"}})).is_err());
    assert_eq!(b.db, snapshot);
    b.path = old_path;
    let cleared=b.request(json!({"op":"update_bot_settings","token":token,"bot":bid,"revision":1,"profile":{"avatar":""}})).unwrap();
    assert_eq!(cleared["profile"]["avatar"], "");
    assert_eq!(cleared["profile"]["name"], "Сомбра");
    assert_eq!(cleared["conversation"], saved["conversation"]);
    assert_eq!(b.db["bots"][0]["owner"], owner);
    drop(b);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn owner_only_actual_dm_and_original_source_reactions() {
    let (mut b, path, token, bot) = fixture();
    let bid = bot["bot"]["id"].clone();
    let bt = bot["token"].clone();
    let channel = b.db["groups"][0]["channels"][0]["id"].clone();
    send(&mut b, &token, &channel, "/ask group");
    assert_eq!(
        b.request(json!({"op":"bot_get_settings","bot_token":bt,"update_id":1}))
            .unwrap_err(),
        "BOT_SETTINGS_FORBIDDEN"
    );
    let dm = b
        .request(json!({"op":"create_dialog","token":token,"members":[bid]}))
        .unwrap();
    send(&mut b, &token, &dm["id"], "change your name");
    let settings = b
        .request(json!({"op":"bot_get_settings","bot_token":bt,"update_id":2}))
        .unwrap();
    assert_eq!(settings["revision"], 0);
    b.request(json!({"op":"bot_update_self","bot_token":bt,"update_id":2,"revision":0,"profile":{"name":"Сомбра","bio":"Owner requested"}})).unwrap();
    assert_eq!(b.db["bots"][0]["name"], "Сомбра");
    let reaction = json!({"op":"bot_react","bot_token":bt,"update_id":1,"emoji":"👍","message":b.db["messages"][1]["id"],"user":b.db["users"][0]["id"]});
    let r = b.request(reaction.clone()).unwrap();
    assert_eq!(r["message"], b.db["messages"][0]["id"]);
    assert_eq!(b.request(reaction.clone()).unwrap(), r);
    assert_eq!(r["reactions"], json!([{"user":bid,"emoji":"👍"}]));
    assert!(b.db["messages"][1]["reactions"].is_null());
    let mut off = reaction;
    off["enabled"] = json!(false);
    assert!(b.request(off.clone()).unwrap()["reactions"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(b.request(off).unwrap()["reactions"]
        .as_array()
        .unwrap()
        .is_empty());
    let guest = json!({"id":id(),"name":"Trusted Admin","active":true});
    b.db["users"].as_array_mut().unwrap().push(guest.clone());
    let gt = json!(b.token(&guest, "test", false).unwrap());
    let other = b
        .request(json!({"op":"create_dialog","token":gt,"members":[bid]}))
        .unwrap();
    b.request(json!({"op":"set_bot_tool_users","token":token,"bot":bid,"revision":0,"users":[guest["id"]]})).unwrap();
    send(&mut b, &gt, &other["id"], "set yourself");
    assert_eq!(
        b.request(json!({"op":"bot_authorize_update","bot_token":bt,"update_id":3}))
            .unwrap()["access"]["trusted"],
        true
    );
    assert_eq!(
        b.request(json!({"op":"bot_get_settings","bot_token":bt,"update_id":3}))
            .unwrap_err(),
        "BOT_SETTINGS_FORBIDDEN"
    );
    b.db["dialogs"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["id"] == dm["id"])
        .unwrap()["members"]
        .as_array_mut()
        .unwrap()
        .push(guest["id"].clone());
    assert!(b.request(json!({"op":"bot_update_self","bot_token":bt,"update_id":2,"revision":1,"profile":{"name":"Bad GroupDM"}})).is_err());
    b.db["messages"][0]["text"] = json!("edited source");
    assert_eq!(
        b.request(json!({"op":"bot_react","bot_token":bt,"update_id":1,"emoji":"❤️"}))
            .unwrap_err(),
        "BOT_SOURCE_UNAVAILABLE"
    );
    drop(b);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[test]
fn natural_names_boundaries_private_followups_ttl_budget_and_mode_off() {
    let (mut b, path, token, bot) = fixture();
    let bid = bot["bot"]["id"].clone();
    let bt = bot["token"].clone();
    let channel = b.db["groups"][0]["channels"][0]["id"].clone();
    let other_channel = b.db["groups"][0]["channels"][1]["id"].clone();
    send(&mut b, &token, &channel, "Сомбра привет");
    assert!(arr(&b.db["bot_updates"]).is_empty());
    b.request(json!({"op":"update_bot_settings","token":token,"bot":bid,"revision":0,"profile":{"name":"Сомбра"},"conversation":{"mode":"name_dialog","aliases":["Sombra","добрый бот"],"followupMessages":2}})).unwrap();
    for text in [
        "несомбра",
        "Сомбратик",
        "_Сомбра_",
        "обычный приватный текст",
    ] {
        send(&mut b, &token, &channel, text);
    }
    assert!(arr(&b.db["bot_updates"]).is_empty());
    send(&mut b, &token, &channel, "СОМБРА, привет");
    assert_eq!(b.db["bot_updates"][0]["reason"], "name");
    let guest = json!({"id":id(),"name":"Other","active":true});
    b.db["users"].as_array_mut().unwrap().push(guest.clone());
    b.db["groups"][0]["members"]
        .as_array_mut()
        .unwrap()
        .push(guest["id"].clone());
    let gt = json!(b.token(&guest, "test", false).unwrap());
    send(&mut b, &gt, &channel, "not addressed");
    send(&mut b, &token, &other_channel, "not this channel");
    assert_eq!(arr(&b.db["bot_updates"]).len(), 1);
    send(&mut b, &token, &channel, "follow one");
    send(&mut b, &token, &channel, "follow two");
    send(&mut b, &token, &channel, "private after budget");
    assert_eq!(arr(&b.db["bot_updates"]).len(), 3);
    assert_eq!(b.db["bot_updates"][2]["reason"], "followup");
    send(&mut b, &token, &channel, "добрый БОТ: listen");
    assert_eq!(arr(&b.db["bot_updates"]).len(), 4);
    b.db["bots"][0]["followups"][0]["until"] = json!(now() - 1);
    send(&mut b, &token, &channel, "expired silent");
    assert_eq!(arr(&b.db["bot_updates"]).len(), 4);
    b.request(json!({"op":"message","token":token,"channel":channel,"text":"Sombra media caption","attachment":{"name":"caption.txt","data":base64::engine::general_purpose::STANDARD.encode(b"caption attachment")}})).unwrap();
    b.request(json!({"op":"bot_reply","bot_token":bt,"update_id":5,"text":"answer"}))
        .unwrap();
    b.db["bots"][0]["followups"][0]["until"] = json!(now() + 1);
    b.request(json!({"op":"bot_ack","bot_token":bt,"update_id":5}))
        .unwrap();
    assert!(b.db["bots"][0]["followups"][0]["until"].as_u64().unwrap() >= now() + 179);
    b.db["bots"][0]["followups"][0]["until"] = json!(now() + 1);
    b.request(json!({"op":"bot_ack","bot_token":bt,"update_id":5}))
        .unwrap();
    assert!(b.db["bots"][0]["followups"][0]["until"].as_u64().unwrap() <= now() + 1);
    send(&mut b, &token, &channel, "/ask command");
    let command_id = b.db["bots"][0]["seq"].clone();
    b.request(json!({"op":"update_bot_settings","token":token,"bot":bid,"revision":1,"conversation":{"mode":"addressed"}})).unwrap();
    assert!(arr(&b.db["bots"][0]["followups"]).is_empty());
    assert_eq!(
        b.request(json!({"op":"bot_authorize_update","bot_token":bt,"update_id":1}))
            .unwrap_err(),
        "BOT_SOURCE_UNAVAILABLE"
    );
    assert!(b
        .request(json!({"op":"bot_authorize_update","bot_token":bt,"update_id":command_id}))
        .is_ok());
    send(&mut b, &token, &channel, "Сомбра no longer opted in");
    assert_eq!(b.db["bots"][0]["seq"], command_id);
    assert!(b.bot_public(&b.db["bots"][0])["followups"].is_null());
    let count = arr(&b.db["bot_updates"]).len();
    b.enqueue_bots(&json!({"id":id(),"channel":channel,"user":bid,"text":"Сомбра self"}))
        .unwrap();
    assert_eq!(arr(&b.db["bot_updates"]).len(), count);
    drop(b);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
