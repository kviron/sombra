use super::*;
impl Backend {
    /// Offline maintenance only: caller must stop the server before opening its database.
    /// This method is intentionally not exposed through the HTTP operation router.
    pub fn provision_group_bot(
        &mut self,
        group_name: &str,
        bot_name: &str,
        username: &str,
    ) -> Result<Value, String> {
        let groups: Vec<_> = arr(&self.db["groups"])
            .into_iter()
            .filter(|g| g["name"] == group_name)
            .collect();
        if groups.len() != 1 {
            return Err("Expected exactly one group matching the exact name".into());
        }
        let group = &groups[0];
        let owner = s(group, "owner");
        if !arr(&self.db["users"])
            .iter()
            .any(|u| u["id"] == owner && u["bot"] != true && u["active"] != false)
        {
            return Err("Group owner is not an active human identity".into());
        }
        let username = username.trim().trim_start_matches('@').to_ascii_lowercase();
        let existing = arr(&self.db["bots"])
            .into_iter()
            .find(|b| b["username"] == username);
        let snapshot = self.db.clone();
        let result = (|| {
            if let Some(bot) = existing {
                if bot["owner"] != owner || bot["legacy"] == true || bot["enabled"] == false {
                    return Err(
                        "Existing username is not an enabled bot owned by this group owner".into(),
                    );
                }
                self.bot_management(
                    &json!({"op":"add_bot_to_group","bot":bot["id"],"group":group["id"]}),
                    owner,
                )?;
                self.bot_management(&json!({"op":"bot_rotate_token","bot":bot["id"]}), owner)
            } else {
                self.bot_management(&json!({"op":"create_bot","group":group["id"],"name":bot_name,"username":username}),owner)
            }
        })();
        if result.is_err() {
            self.db = snapshot;
            self.save()?;
        }
        result.map(|result| json!({"token":result["token"],"bot":result["bot"]}))
    }
    pub(super) fn migrate_bots(&mut self) {
        if self.db["bot_updates"].is_null() {
            self.db["bot_updates"] = json!([])
        }
        for bot in self.db["bots"].as_array_mut().unwrap() {
            if bot["legacy"].is_null() {
                bot["legacy"] = json!(true)
            }
            if bot["enabled"].is_null() {
                bot["enabled"] = json!(true)
            }
            if bot["commands"].is_null() {
                bot["commands"] = json!(["start", "help", "ask", "ai", "reset"])
            }
            if bot["groups"].is_null() {
                bot["groups"] = json!([])
            }
            bot["privacy"] = json!(if bot["legacy"] == true {
                "legacy_room_history"
            } else {
                "commands_only"
            });
        }
        for bot in arr(&self.db["bots"]) {
            if !arr(&self.db["users"]).iter().any(|u| u["id"] == bot["id"]) {
                self.db["users"].as_array_mut().unwrap().push(json!({"id":bot["id"],"name":bot["name"],"username":bot["username"],"bot":true,"active":bot["enabled"],"created_at":now(),"bio":""}));
            }
            let user = self.db["users"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|u| u["id"] == bot["id"])
                .unwrap();
            user["bot"] = json!(true);
            user["username"] = bot["username"].clone();
            user["active"] = json!(bot["enabled"] != false);
            for key in ["email", "salt", "hash"] {
                user.as_object_mut().unwrap().remove(key);
            }
            self.db["sessions"]
                .as_array_mut()
                .unwrap()
                .retain(|session| session["user_id"] != bot["id"]);
        }
    }
    pub(super) fn bot_commands(&self, b: &Value) -> Value {
        json!(arr(&b["commands"]).iter().filter_map(|c|c.as_str()).map(|command|json!({"command":command,"description":match command {"start"=>"Начать общение", "help"=>"Список команд", "ask"=>"Задать вопрос", "ai"=>"Спросить ИИ", "reset"=>"Сбросить контекст", _=>"Команда бота"}})).collect::<Vec<_>>())
    }
    fn installed_bot_count(&self, group: &Value) -> usize {
        arr(&self.db["bots"])
            .iter()
            .filter(|b| b["enabled"] != false && arr(&b["groups"]).contains(group))
            .count()
    }
    pub(super) fn bot_public(&self, b: &Value) -> Value {
        let mut out = b.clone();
        out["commands"] = self.bot_commands(b);
        out["privacy"] = json!(if b["legacy"] == true {
            "legacy_room_history"
        } else {
            "commands_only"
        });
        for key in ["token_hash", "ack", "seq"] {
            out.as_object_mut().unwrap().remove(key);
        }
        out
    }
    pub(super) fn visible_bots(&self, uid: &str) -> Vec<Value> {
        arr(&self.db["bots"])
            .iter()
            .filter(|b| {
                b["owner"] == uid
                    || (b["legacy"] != true
                        && arr(&self.db["dialogs"]).iter().any(|d| {
                            arr(&d["members"]).len() == 2
                                && arr(&d["members"]).contains(&json!(uid))
                                && arr(&d["members"]).contains(&b["id"])
                        }))
                    || self.allowed(uid, s(b, "channel"))
                    || arr(&b["groups"]).iter().any(|gid| {
                        arr(&self.db["groups"])
                            .iter()
                            .any(|g| g["id"] == *gid && arr(&g["members"]).contains(&json!(uid)))
                    })
            })
            .map(|b| self.bot_public(b))
            .collect()
    }
    fn bot_target_allowed(&self, b: &Value, channel: &str) -> bool {
        if b["enabled"] == false {
            return false;
        }
        if b["legacy"] == true {
            return b["channel"] == channel
                && arr(&self.db["groups"])
                    .iter()
                    .any(|g| arr(&g["channels"]).iter().any(|c| c["id"] == channel));
        }
        arr(&self.db["groups"]).iter().any(|g| {
            arr(&b["groups"]).contains(&g["id"])
                && arr(&g["members"]).contains(&b["id"])
                && arr(&g["channels"]).iter().any(|c| c["id"] == channel)
        }) || arr(&self.db["dialogs"]).iter().any(|d| {
            d["id"] == channel
                && arr(&d["members"]).len() == 2
                && arr(&d["members"]).contains(&b["id"])
        })
    }
    pub(super) fn bot_management(&mut self, v: &Value, uid: &str) -> Result<Value, String> {
        let op = s(v, "op");
        if op == "create_bot" {
            let name = s(v, "name").trim();
            if name.is_empty() || name.chars().count() > 32 {
                return Err("Имя бота: 1–32 символа".into());
            }
            let legacy = s(v, "group").is_empty();
            let group = arr(&self.db["groups"])
                .into_iter()
                .find(|g| {
                    g["owner"] == uid
                        && if legacy {
                            arr(&g["channels"]).iter().any(|c| c["id"] == v["channel"])
                        } else {
                            g["id"] == v["group"]
                        }
                })
                .ok_or("Бота подключает владелец группы")?;
            let username = s(v, "username")
                .trim()
                .trim_start_matches('@')
                .to_ascii_lowercase();
            if !legacy
                && (username.len() < 3
                    || username.len() > 32
                    || !username
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'_')
                    || arr(&self.db["bots"])
                        .iter()
                        .any(|b| b["username"] == username))
            {
                return Err(
                    "Укажите уникальный username: 3–32 латинских символа, цифры или _".into(),
                );
            }
            if legacy
                && arr(&self.db["bots"])
                    .iter()
                    .filter(|b| b["channel"] == v["channel"] && b["enabled"] != false)
                    .count()
                    >= 5
            {
                return Err("Не более 5 ботов в комнате".into());
            }
            if !legacy && self.installed_bot_count(&group["id"]) >= 5 {
                return Err("Не более 5 ботов в группе".into());
            }
            let token = format!("{}{}", id(), id());
            let bid = id();
            let mut bot = json!({"id":bid,"name":name,"owner":uid,"username":if legacy{Value::Null}else{json!(username)},"legacy":legacy,"enabled":true,"token_hash":token_hash(&token),"groups":if legacy{json!([])}else{json!([group["id"]])},"commands":["start","help","ask","ai","reset"],"privacy":"commands_only","ack":0,"seq":0});
            if legacy {
                bot["channel"] = v["channel"].clone()
            } else {
                bot["group"] = group["id"].clone();
                self.db["groups"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|g| g["id"] == group["id"])
                    .unwrap()["members"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(bid));
            }
            self.db["bots"].as_array_mut().unwrap().push(bot.clone());
            self.migrate_bots();
            self.save()?;
            let user = arr(&self.db["users"])
                .into_iter()
                .find(|u| u["id"] == bid)
                .unwrap();
            return Ok(
                json!({"token":token,"bot":self.bot_public(&bot),"user":self.public(&user)}),
            );
        }
        let bid = if v["bot"].is_string() {
            &v["bot"]
        } else {
            &v["id"]
        };
        let i = self.db["bots"]
            .as_array()
            .unwrap()
            .iter()
            .position(|b| b["id"] == *bid)
            .ok_or("Бот не найден")?;
        let bot = self.db["bots"][i].clone();
        if op == "add_bot_to_group" || op == "remove_bot_from_group" {
            let gi = self.db["groups"]
                .as_array()
                .unwrap()
                .iter()
                .position(|g| g["id"] == v["group"] && g["owner"] == uid)
                .ok_or("Только владелец группы")?;
            if bot["legacy"] == true || bot["enabled"] == false {
                return Err("Бот недоступен".into());
            }
            if op == "add_bot_to_group" {
                if bot["owner"] != uid {
                    return Err("Только владелец бота".into());
                }
                if !arr(&bot["groups"]).contains(&v["group"]) {
                    if self.installed_bot_count(&v["group"]) >= 5 {
                        return Err("Не более 5 ботов в группе".into());
                    }
                    self.db["bots"][i]["groups"]
                        .as_array_mut()
                        .unwrap()
                        .push(v["group"].clone());
                }
                if !arr(&self.db["groups"][gi]["members"]).contains(&bot["id"]) {
                    self.db["groups"][gi]["members"]
                        .as_array_mut()
                        .unwrap()
                        .push(bot["id"].clone());
                }
            } else {
                self.db["bots"][i]["groups"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|g| *g != v["group"]);
                self.db["groups"][gi]["members"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|u| *u != bot["id"]);
                let channels = arr(&self.db["groups"][gi]["channels"]);
                self.db["bot_updates"].as_array_mut().unwrap().retain(|u| {
                    !(u["bot"] == bot["id"] && channels.iter().any(|c| c["id"] == u["channel"]))
                });
            }
        } else {
            if bot["owner"] != uid {
                return Err("Только владелец бота".into());
            }
            if op == "bot_rotate_token" {
                if bot["enabled"] == false {
                    return Err("Бот удалён".into());
                }
                let token = format!("{}{}", id(), id());
                self.db["bots"][i]["token_hash"] = json!(token_hash(&token));
                self.save()?;
                return Ok(json!({"token":token,"bot":self.bot_public(&self.db["bots"][i])}));
            }
            if op == "bot_set_commands" {
                let commands = arr(&v["commands"]);
                if commands.len() > 32
                    || commands.iter().any(|c| {
                        c.as_str().is_none_or(|s| {
                            s.is_empty()
                                || s.len() > 32
                                || !s.bytes().all(|c| {
                                    c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_'
                                })
                        })
                    })
                {
                    return Err("Некорректные команды".into());
                }
                self.db["bots"][i]["commands"] = json!(commands);
            } else if op == "delete_bot" {
                self.db["bots"][i]["enabled"] = json!(false);
                self.db["bots"][i]["token_hash"] = Value::Null;
                self.db["bots"][i]["groups"] = json!([]);
                for g in self.db["groups"].as_array_mut().unwrap() {
                    g["members"]
                        .as_array_mut()
                        .unwrap()
                        .retain(|u| *u != bot["id"]);
                }
                for u in self.db["users"].as_array_mut().unwrap() {
                    if u["id"] == bot["id"] {
                        u["active"] = json!(false)
                    }
                }
                self.db["bot_updates"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|u| u["bot"] != bot["id"]);
            }
        }
        self.save()?;
        Ok(json!({"ok":true}))
    }
    pub(super) fn enqueue_bots(&mut self, message: &Value) -> Result<(), String> {
        let sender = arr(&self.db["users"])
            .into_iter()
            .find(|u| u["id"] == message["user"])
            .ok_or("Пользователь не найден")?;
        if sender["bot"] == true {
            return Ok(());
        }
        let channel = s(message, "channel");
        let group = arr(&self.db["groups"])
            .into_iter()
            .find(|g| arr(&g["channels"]).iter().any(|c| c["id"] == channel));
        let mut pending = Vec::new();
        for (index, b) in arr(&self.db["bots"]).iter().enumerate() {
            if b["legacy"] == true || !self.bot_target_allowed(b, channel) {
                continue;
            }
            let text = s(message, "text");
            let mut command = Value::Null;
            if let Some(rest) = text.strip_prefix('/') {
                let (head, args) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
                let (name, target) = head.split_once('@').unwrap_or((head, ""));
                if arr(&b["commands"]).contains(&json!(name))
                    && (target.is_empty() || target.eq_ignore_ascii_case(s(b, "username")))
                {
                    command = json!({"name":name,"args":args.trim()});
                }
            }
            let mention = text
                .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '@'))
                .any(|word| word.eq_ignore_ascii_case(&format!("@{}", s(b, "username"))));
            if group.is_some() && command.is_null() && !mention {
                continue;
            }
            if arr(&self.db["bot_updates"])
                .iter()
                .filter(|u| u["bot"] == b["id"] && u["done"] != true)
                .count()
                >= 1000
            {
                return Err("BOT_QUEUE_FULL: retry later; pending updates are retained".into());
            }
            let seq = b["seq"].as_u64().unwrap_or(0) + 1;
            let chat = if let Some(ref g) = group {
                json!({"id":g["id"],"kind":"group","name":g["name"]})
            } else {
                json!({"id":channel,"kind":"direct","name":sender["name"]})
            };
            let mut update = json!({"bot":b["id"],"update_id":seq,"channel":channel,"message":self.public_message(message),"sender":{"id":sender["id"],"name":sender["name"]},"chat":chat,"done":false});
            if !command.is_null() {
                update["command"] = command
            }
            pending.push((index, seq, update));
        }
        for (i, seq, u) in pending {
            self.db["bots"][i]["seq"] = json!(seq);
            self.db["bot_updates"].as_array_mut().unwrap().push(u);
        }
        Ok(())
    }
    pub(super) fn bot_worker(&mut self, v: &Value) -> Result<Value, String> {
        let token = s(v, "bot_token");
        if token.is_empty() {
            return Err("AUTH_REQUIRED".into());
        }
        let i = self.db["bots"]
            .as_array()
            .unwrap()
            .iter()
            .position(|b| b["enabled"] != false && b["token_hash"] == token_hash(token))
            .ok_or("AUTH_REQUIRED")?;
        let op = s(v, "op");
        if op == "bot_get_me" || op == "bot_get_updates" {
            let bot_id = s(&self.db["bots"][i], "id").to_owned();
            self.touch_presence(&bot_id);
        }
        if (op == "bot_get_me" || (op == "bot_get_updates" && self.db["bots"][i]["legacy"] != true))
            && self.db["bots"][i]["last_seen"]
                .as_u64()
                .unwrap_or(0)
                .saturating_add(60)
                < now()
        {
            self.db["bots"][i]["last_seen"] = json!(now());
            self.save()?;
        }
        let b = self.db["bots"][i].clone();
        if op == "bot_get_me" {
            let u = arr(&self.db["users"])
                .into_iter()
                .find(|u| u["id"] == b["id"])
                .ok_or("AUTH_REQUIRED")?;
            return Ok(
                json!({"user":self.public(&u),"bot":self.bot_public(&b),"installs":b["groups"]}),
            );
        }
        if op == "bot_poll" || op == "bot_message" {
            if b["legacy"] != true || !self.bot_target_allowed(&b, s(&b, "channel")) {
                return Err("Legacy room token required".into());
            }
            if op == "bot_poll" {
                return Ok(
                    json!({"messages":arr(&self.db["messages"]).iter().filter(|m|m["channel"]==b["channel"]).map(|m|self.public_message(m)).collect::<Vec<_>>()}),
                );
            }
            let text = s(v, "text").trim();
            if text.is_empty() || text.chars().count() > 2000 {
                return Err("Сообщение: 1–2000 символов".into());
            }
            self.db["messages"].as_array_mut().unwrap().push(json!({"id":id(),"channel":b["channel"],"user":b["id"],"bot_name":b["name"],"text":text,"time":now()}));
            self.save()?;
            return Ok(json!({"ok":true}));
        }
        if b["legacy"] == true {
            return Err("Legacy tokens are room-only".into());
        }
        if op == "bot_get_updates" {
            let after = v["after"].as_u64().unwrap_or(0);
            let limit = v["limit"].as_u64().unwrap_or(50).clamp(1, 50) as usize;
            let updates = arr(&self.db["bot_updates"])
                .into_iter()
                .filter(|u| {
                    u["bot"] == b["id"]
                        && u["done"] != true
                        && u["update_id"].as_u64().unwrap_or(0) > after
                        && self.bot_target_allowed(&b, s(u, "channel"))
                })
                .take(limit)
                .map(|mut u| {
                    for k in ["bot", "done", "response"] {
                        u.as_object_mut().unwrap().remove(k);
                    }
                    u
                })
                .collect::<Vec<_>>();
            return Ok(json!({"updates":updates,"ack":b["ack"].as_u64().unwrap_or(0)}));
        }
        let ui = self.db["bot_updates"]
            .as_array()
            .unwrap()
            .iter()
            .position(|u| u["bot"] == b["id"] && u["update_id"] == v["update_id"])
            .ok_or("Update not found")?;
        let update = self.db["bot_updates"][ui].clone();
        if !self.bot_target_allowed(&b, s(&update, "channel")) {
            return Err("Install removed".into());
        }
        if op == "bot_ack" {
            self.db["bot_updates"][ui]["done"] = json!(true);
            let ack = arr(&self.db["bot_updates"])
                .iter()
                .filter(|u| u["bot"] == b["id"] && u["done"] != true)
                .filter_map(|u| u["update_id"].as_u64())
                .min()
                .map(|n| n - 1)
                .unwrap_or(b["seq"].as_u64().unwrap_or(0));
            self.db["bots"][i]["ack"] = json!(ack);
            self.save()?;
            return Ok(json!({"ok":true,"ack":ack}));
        }
        if op != "bot_reply" {
            return Err("Неизвестная команда".into());
        }
        if v.get("channel").is_some() || v.get("response_key").is_some_and(|k| k != "main") {
            return Err("Only update target and main response_key allowed".into());
        }
        if !self.allowed(s(&update["sender"], "id"), s(&update, "channel")) {
            return Err("Sender no longer has access".into());
        }
        if update["response"].is_object() {
            return Ok(update["response"].clone());
        }
        let text = s(v, "text").trim();
        if text.is_empty() || text.chars().count() > 2000 {
            return Err("Сообщение: 1–2000 символов".into());
        }
        let m = json!({"id":id(),"channel":update["channel"],"user":b["id"],"bot_name":b["name"],"text":text,"time":now()});
        self.db["messages"].as_array_mut().unwrap().push(m.clone());
        self.db["bot_updates"][ui]["response"] = m.clone();
        self.db["bots"][i]["last_seen"] = json!(now());
        self.save()?;
        Ok(m)
    }
}

#[cfg(test)]
mod bot_tests {
    use super::*;
    #[test]
    fn live_poll_refreshes_presence_without_rewriting_heartbeat() {
        let path=std::env::temp_dir().join(id()).join("db.json");
        let mut b=Backend::open(path).unwrap();
        let owner=s(&b.db["users"][0],"id").to_owned();
        let group=b.db["groups"][0]["id"].clone();
        let bot=b.bot_management(&json!({"op":"create_bot","group":group,"name":"Heartbeat","username":"heartbeat"}),&owner).unwrap();
        let bid=s(&bot["bot"],"id").to_owned();
        let previous=now()-50;
        b.db["bots"][0]["last_seen"]=json!(previous);
        b.bot_worker(&json!({"op":"bot_get_updates","bot_token":bot["token"]})).unwrap();
        assert_eq!(b.db["bots"][0]["last_seen"],json!(previous));
        assert!(b.public(&bot["user"])["online"].as_bool().unwrap());
        assert!(b.presence.contains_key(&bid));
    }
    #[test]
    fn identities_privacy_durable_updates_and_revocation() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let owner = b.db["users"][0].clone();
        let token = b.token(&owner, "test", false).unwrap();
        let group = b.db["groups"][0]["id"].clone();
        let channel = b.db["groups"][0]["channels"][0]["id"].clone();
        let guest=b.request(json!({"op":"register","name":"Guest","email":"bot-outsider@test.local","password":"strong-password"})).unwrap();
        assert!(b.request(json!({"op":"create_bot","token":guest["token"],"group":group,"name":"Bot","username":"helper"})).is_err());
        b.request(json!({"op":"message","token":token,"channel":channel,"text":"/ai old history"}))
            .unwrap();
        let bot=b.request(json!({"op":"create_bot","token":token,"group":group,"name":"Bot","username":"helper"})).unwrap();
        let bt = bot["token"].clone();
        let bid = bot["bot"]["id"].clone();
        assert_eq!(bot["user"]["bot"], true);
        assert_eq!(bot["user"]["id"], bid);
        assert!(b
            .request(json!({"op":"friend_request","token":token,"user":bid}))
            .is_err());
        assert!(b.request(json!({"op":"state","token":bt})).is_err());
        assert!(b.request(json!({"op":"bot_poll","bot_token":bt})).is_err());
        for text in [
            "ordinary private text",
            "/unknown hello",
            "/ai@someone_else hi",
        ] {
            b.request(json!({"op":"message","token":token,"channel":channel,"text":text}))
                .unwrap();
        }
        assert_eq!(
            b.request(json!({"op":"bot_get_updates","bot_token":bt}))
                .unwrap()["updates"],
            json!([])
        );
        for text in ["/ai@helper hello", "hello @helper"] {
            b.request(json!({"op":"message","token":token,"channel":channel,"text":text}))
                .unwrap();
        }
        let updates = b
            .request(json!({"op":"bot_get_updates","bot_token":bt}))
            .unwrap();
        assert_eq!(arr(&updates["updates"]).len(), 2);
        assert_eq!(
            updates["updates"][0]["command"],
            json!({"name":"ai","args":"hello"})
        );
        let reply = json!({"op":"bot_reply","bot_token":bt,"update_id":1,"text":"/ai reply"});
        let response = b.request(reply.clone()).unwrap();
        assert_eq!(
            arr(&b
                .request(json!({"op":"bot_get_updates","bot_token":bt}))
                .unwrap()["updates"])
            .len(),
            2
        );
        assert_eq!(
            b.request(json!({"op":"bot_ack","bot_token":bt,"update_id":2}))
                .unwrap()["ack"],
            0
        );
        assert!(b
            .request(json!({"op":"bot_ack","bot_token":bt,"update_id":999}))
            .is_err());
        drop(b);
        let mut b = Backend::open(path.clone()).unwrap();
        assert_eq!(b.request(reply).unwrap(), response);
        assert_eq!(
            b.request(json!({"op":"bot_ack","bot_token":bt,"update_id":1}))
                .unwrap()["ack"],
            2
        );
        let dialog = b
            .request(json!({"op":"create_dialog","token":guest["token"],"members":[bid]}))
            .unwrap();
        b.request(
            json!({"op":"message","token":guest["token"],"channel":dialog["id"],"text":"plain DM"}),
        )
        .unwrap();
        let u = b
            .request(json!({"op":"bot_get_updates","bot_token":bt}))
            .unwrap();
        assert_eq!(u["updates"][0]["chat"]["kind"], "direct");
        assert_eq!(arr(&u["updates"]).len(), 1);
        assert!(b
            .visible_bots(s(&guest["user"], "id"))
            .iter()
            .any(|bot| bot["id"] == bid));
        b.request(json!({"op":"message","token":token,"channel":channel,"text":"/help"}))
            .unwrap();
        b.request(json!({"op":"remove_bot_from_group","token":token,"bot":bid,"group":group}))
            .unwrap();
        assert!(b
            .request(json!({"op":"bot_reply","bot_token":bt,"update_id":4,"text":"late"}))
            .is_err());
        assert!(b
            .visible_bots(s(&guest["user"], "id"))
            .iter()
            .any(|bot| bot["id"] == bid));
        let rotated = b
            .request(json!({"op":"bot_rotate_token","token":token,"bot":bid}))
            .unwrap();
        assert!(b
            .request(json!({"op":"bot_get_me","bot_token":bt}))
            .is_err());
        b.request(json!({"op":"delete_bot","token":token,"bot":bid}))
            .unwrap();
        assert!(b
            .request(json!({"op":"bot_get_me","bot_token":rotated["token"]}))
            .is_err());
        assert!(arr(&b.db["users"])
            .iter()
            .any(|u| u["id"] == bid && u["active"] == false));
        drop(b);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn offline_provisioning_uses_exact_group_owner_and_rotates() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let group = b.db["groups"][0].clone();
        let group_name = s(&group, "name");
        assert!(b
            .provision_group_bot("missing", "Helper", "offlinehelper")
            .is_err());
        let first = b
            .provision_group_bot(group_name, "Helper", "offlinehelper")
            .unwrap();
        assert_eq!(first["bot"]["owner"], group["owner"]);
        assert_eq!(first["bot"]["groups"], json!([group["id"]]));
        assert!(arr(&b.db["sessions"]).is_empty());
        let second = b
            .provision_group_bot(group_name, "Helper", "offlinehelper")
            .unwrap();
        assert_eq!(first["bot"]["id"], second["bot"]["id"]);
        assert_ne!(first["token"], second["token"]);
        assert_eq!(arr(&b.db["bots"]).len(), 1);
        assert!(b
            .bot_worker(&json!({"op":"bot_get_me","bot_token":first["token"]}))
            .is_err());
        b.db["bots"][0]["owner"] = json!("someone_else");
        let before = b.db.clone();
        assert!(b
            .provision_group_bot(group_name, "Helper", "offlinehelper")
            .is_err());
        assert_eq!(b.db, before);
        let mut duplicate = group.clone();
        duplicate["id"] = json!(id());
        b.db["groups"].as_array_mut().unwrap().push(duplicate);
        let before = b.db.clone();
        assert!(b
            .provision_group_bot(group_name, "Helper", "anotherhelper")
            .is_err());
        assert_eq!(b.db, before);
        drop(b);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn voice_channel_messages_keep_group_command_privacy() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let owner = b.db["users"][0].clone();
        let group = b.db["groups"][0]["id"].clone();
        let channel = b.db["groups"][0]["channels"][4]["id"].clone();
        let bot = b
            .bot_management(
                &json!({"op":"create_bot","group":group,"name":"Helper","username":"voicehelper"}),
                s(&owner, "id"),
            )
            .unwrap();
        for text in [
            "ordinary private voice-room text",
            "/unknown secret",
            "/ask@other secret",
        ] {
            b.enqueue_bots(
                &json!({"id":id(),"channel":channel,"user":owner["id"],"text":text,"time":now()}),
            )
            .unwrap();
        }
        assert!(arr(&b.db["bot_updates"]).is_empty());
        b.enqueue_bots(&json!({"id":id(),"channel":channel,"user":owner["id"],"text":"/ask@voicehelper hello","time":now()})).unwrap();
        let updates = b
            .bot_worker(&json!({"op":"bot_get_updates","bot_token":bot["token"]}))
            .unwrap();
        assert_eq!(arr(&updates["updates"]).len(), 1);
        assert_eq!(updates["updates"][0]["chat"]["kind"], "group");
        assert_eq!(updates["updates"][0]["chat"]["id"], group);
        assert_eq!(
            updates["updates"][0]["command"],
            json!({"name":"ask","args":"hello"})
        );
        drop(b);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn public_contract_capacity_and_sender_revocation() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let owner = b.db["users"][0].clone();
        let uid = s(&owner, "id");
        let group = b.db["groups"][0]["id"].clone();
        let channel = b.db["groups"][0]["channels"][0]["id"].clone();
        let first = b
            .bot_management(
                &json!({"op":"create_bot","group":group,"name":"Helper","username":"helper0"}),
                uid,
            )
            .unwrap();
        assert_eq!(
            first["bot"]["commands"][0],
            json!({"command":"start","description":"Начать общение"})
        );
        assert_eq!(first["user"]["commands"], first["bot"]["commands"]);
        assert_eq!(first["user"]["enabled"], true);
        assert_eq!(first["user"]["active"], true);
        for i in 1..5 {
            b.bot_management(&json!({"op":"create_bot","group":group,"name":"Helper","username":format!("helper{i}")}),uid).unwrap();
        }
        assert!(b
            .bot_management(
                &json!({"op":"create_bot","group":group,"name":"Helper","username":"helper6"}),
                uid
            )
            .is_err());
        let sender = json!({"id":"human","name":"Human"});
        b.db["users"].as_array_mut().unwrap().push(sender);
        b.db["groups"][0]["members"]
            .as_array_mut()
            .unwrap()
            .push(json!("human"));
        let message =
            json!({"id":id(),"channel":channel,"user":"human","text":"/ai question","time":now()});
        b.enqueue_bots(&message).unwrap();
        b.db["groups"][0]["members"]
            .as_array_mut()
            .unwrap()
            .retain(|u| u != "human");
        assert!(b.bot_worker(&json!({"op":"bot_reply","bot_token":first["token"],"update_id":1,"text":"No longer permitted"})).is_err());
        let legacy = b
            .bot_management(
                &json!({"op":"create_bot","channel":channel,"name":"Legacy"}),
                uid,
            )
            .unwrap();
        assert_eq!(legacy["bot"]["privacy"], "legacy_room_history");
        drop(b);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn legacy_migration_remains_room_only() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let owner = b.db["users"][0].clone();
        let token = b.token(&owner, "test", false).unwrap();
        let channel = b.db["groups"][0]["channels"][0]["id"].clone();
        let bot = b
            .request(json!({"op":"create_bot","token":token,"channel":channel,"name":"Legacy"}))
            .unwrap();
        let bid = b.db["bots"][0]["id"].clone();
        b.db["bots"][0].as_object_mut().unwrap().remove("legacy");
        b.db["users"]
            .as_array_mut()
            .unwrap()
            .retain(|u| u["id"] != bid);
        b.save().unwrap();
        drop(b);
        let mut b = Backend::open(path.clone()).unwrap();
        assert_eq!(b.db["bots"][0]["legacy"], true);
        let identity = arr(&b.db["users"])
            .into_iter()
            .find(|u| u["id"] == bid)
            .unwrap();
        assert_eq!(identity["bot"], true);
        assert!(identity["hash"].is_null());
        assert!(b
            .request(json!({"op":"create_dialog","token":token,"members":[bid]}))
            .is_err());
        assert!(b
            .request(json!({"op":"bot_get_updates","bot_token":bot["token"]}))
            .is_err());
        assert!(b
            .request(json!({"op":"bot_poll","bot_token":bot["token"]}))
            .is_ok());
        drop(b);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
