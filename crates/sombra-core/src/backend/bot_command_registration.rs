//! Service-token registration is append-only; never accepts a target bot or policy.
use super::*;

pub(super) fn merge(current: &Value, request: &Value) -> Result<Value, String> {
    const INVALID: &str = "Некорректные команды";
    if request
        .as_object()
        .ok_or(INVALID)?
        .keys()
        .any(|key| !["op", "bot_token", "token", "commands"].contains(&key.as_str()))
    {
        return Err(INVALID.into());
    }
    let incoming = request["commands"].as_array().ok_or(INVALID)?;
    if !(1..=32).contains(&incoming.len()) {
        return Err(INVALID.into());
    }
    let mut seen = std::collections::HashSet::new();
    for command in incoming {
        let command = command.as_str().ok_or(INVALID)?;
        if command.is_empty()
            || command.len() > 32
            || !command
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
            || !seen.insert(command)
        {
            return Err(INVALID.into());
        }
    }
    let mut commands = current.as_array().cloned().ok_or(INVALID)?;
    for command in incoming {
        if !commands.contains(command) {
            commands.push(command.clone());
        }
    }
    if commands.len() > 32 {
        return Err(INVALID.into());
    }
    Ok(json!(commands))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Backend, String, Value, Value) {
        let mut backend = Backend::open(std::env::temp_dir().join(id()).join("db.json")).unwrap();
        let owner = backend.db["users"][0].clone();
        let token = backend.token(&owner, "commands", false).unwrap();
        let group = backend.db["groups"][0]["id"].clone();
        let first = backend.request(json!({"op":"create_bot","token":token,"group":group,"name":"First","username":"first_bot"})).unwrap();
        let second = backend.request(json!({"op":"create_bot","token":token,"group":group,"name":"Second","username":"second_bot"})).unwrap();
        (backend, token, first, second)
    }
    fn register(bot: &Value, commands: Value) -> Value {
        json!({"op":"bot_register_commands","bot_token":bot["token"],"commands":commands})
    }

    #[test]
    fn append_preserves_custom_commands_policy_other_bot_and_is_idempotent() {
        let (mut backend, owner, first, _) = fixture();
        backend.request(json!({"op":"bot_set_commands","token":owner,"bot":first["bot"]["id"],"commands":["custom","help"]})).unwrap();
        let before = backend.db.clone();
        assert_eq!(
            backend.request(register(&first, json!(["model"]))).unwrap(),
            json!({"commands":["custom","help","model"]})
        );
        let after = backend.db.clone();
        assert_eq!(
            backend.request(register(&first, json!(["model"]))).unwrap(),
            json!({"commands":["custom","help","model"]})
        );
        assert_eq!(backend.db, after);
        let mut expected = before;
        expected["bots"][0]["commands"] = json!(["custom", "help", "model"]);
        assert_eq!(backend.db, expected);
        let me = backend
            .request(json!({"op":"bot_get_me","bot_token":first["token"]}))
            .unwrap();
        assert_eq!(me["commandRegistrationSupported"], true);
        assert!(me.to_string().find("token_hash").is_none());
    }

    #[test]
    fn malformed_overflow_legacy_rotation_and_disabled_fail_atomically() {
        let (mut backend, owner, first, _) = fixture();
        for commands in [
            json!(null),
            json!([]),
            json!("model"),
            json!(["MODEL"]),
            json!(["has-dash"]),
            json!([""]),
            json!(["a".repeat(33)]),
            json!(["model", "model"]),
            json!([42]),
        ] {
            let before = backend.db.clone();
            assert!(backend.request(register(&first, commands)).is_err());
            assert_eq!(backend.db, before);
        }
        for key in ["bot", "owner", "group", "metadata", "privacy", "toolPolicy"] {
            let before = backend.db.clone();
            let mut request = register(&first, json!(["model"]));
            request[key] = json!("foreign");
            assert!(backend.request(request).is_err());
            assert_eq!(backend.db, before);
        }
        backend.db["bots"][0]["commands"] =
            json!((0..32).map(|i| format!("cmd{i}")).collect::<Vec<_>>());
        let before = backend.db.clone();
        assert!(backend.request(register(&first, json!(["model"]))).is_err());
        assert_eq!(backend.db, before);
        backend.db["bots"][0]["legacy"] = json!(true);
        assert!(backend.request(register(&first, json!(["model"]))).is_err());
        assert_eq!(
            backend
                .request(json!({"op":"bot_get_me","bot_token":first["token"]}))
                .unwrap()["commandRegistrationSupported"],
            false
        );
        backend.db["bots"][0]["legacy"] = json!(false);
        let rotated = backend
            .request(json!({"op":"bot_rotate_token","token":owner,"bot":first["bot"]["id"]}))
            .unwrap();
        assert_eq!(
            backend.request(register(&first, json!(["model"]))),
            Err("AUTH_REQUIRED".into())
        );
        backend.db["bots"][0]["enabled"] = json!(false);
        assert_eq!(
            backend.request(register(&rotated, json!(["model"]))),
            Err("AUTH_REQUIRED".into())
        );
    }

    #[tokio::test]
    async fn http_bearer_registers_self_and_explicit_command_queues_only_own_bot() {
        let (mut backend, owner_token, first, second) = fixture();
        let member = json!({"id":id(),"name":"Member"});
        backend.db["users"]
            .as_array_mut()
            .unwrap()
            .push(member.clone());
        let member_token = backend.token(&member, "member", false).unwrap();
        backend.db["groups"][0]["members"]
            .as_array_mut()
            .unwrap()
            .push(member["id"].clone());
        let channel = backend.db["groups"][0]["channels"][0]["id"].clone();
        backend.save().unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/api", listener.local_addr().unwrap());
        let server =
            tokio::spawn(async move { axum::serve(listener, api_router(backend)).await.unwrap() });
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::new();
        let request = json!({"op":"bot_register_commands","commands":["model"]});
        assert_eq!(
            client
                .post(&url)
                .header("cookie", format!("mines_session={owner_token}"))
                .json(&request)
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        let result = client
            .post(&url)
            .bearer_auth(first["token"].as_str().unwrap())
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(result.status(), 200);
        let result: Value = result.json().await.unwrap();
        assert!(result["data"]["commands"]
            .as_array()
            .unwrap()
            .contains(&json!("model")));
        assert!(result.to_string().find("token").is_none());
        let mut forged = request.clone();
        forged["bot"] = second["bot"]["id"].clone();
        assert_eq!(
            client
                .post(&url)
                .bearer_auth(first["token"].as_str().unwrap())
                .json(&forged)
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
        let response = client
            .post(&url)
            .header("cookie", format!("mines_session={member_token}"))
            .json(&json!({"op":"message","channel":channel,"text":"/model@first_bot"}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        for (bot, count) in [(&first, 1), (&second, 0)] {
            let response = client
                .post(&url)
                .bearer_auth(bot["token"].as_str().unwrap())
                .json(&json!({"op":"bot_get_updates"}))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 200);
            assert_eq!(
                response.json::<Value>().await.unwrap()["data"]["updates"]
                    .as_array()
                    .unwrap()
                    .len(),
                count
            );
        }
        let rotated = client
            .post(&url)
            .header("cookie", format!("mines_session={owner_token}"))
            .json(&json!({"op":"bot_rotate_token","bot":first["bot"]["id"]}))
            .send()
            .await
            .unwrap();
        assert_eq!(rotated.status(), 200);
        let rotated: Value = rotated.json().await.unwrap();
        let new_token = rotated["data"]["token"].as_str().unwrap();
        assert_eq!(
            client
                .post(&url)
                .bearer_auth(first["token"].as_str().unwrap())
                .json(&request)
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        assert_eq!(
            client
                .post(&url)
                .bearer_auth(new_token)
                .json(&request)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(
            client
                .post(&url)
                .header("cookie", format!("mines_session={owner_token}"))
                .json(&json!({"op":"delete_bot","bot":first["bot"]["id"]}))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(
            client
                .post(&url)
                .bearer_auth(new_token)
                .json(&request)
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        server.abort();
    }
}
