//! Owner-scoped profile controls and opt-in addressed conversations, not runtime tool grants.
use super::*;
#[cfg(test)]
#[path = "bot_management_tests.rs"]
mod tests;
impl Backend {
    /// Offline maintenance only: stop the service and back up its single-writer database first.
    pub(crate) fn configure_bot_offline(
        &mut self,
        username: &str,
        patch: &Value,
    ) -> Result<Value, String> {
        let object = patch.as_object().ok_or("BOT_SETTINGS_INVALID")?;
        if object.is_empty()
            || object
                .keys()
                .any(|k| !["profile", "conversation"].contains(&k.as_str()))
        {
            return Err("BOT_SETTINGS_INVALID".into());
        }
        let matches: Vec<_> = arr(&self.db["bots"])
            .into_iter()
            .filter(|b| b["username"] == username && b["legacy"] != true && b["enabled"] != false)
            .collect();
        if matches.len() != 1 {
            return Err("BOT_SETTINGS_UNAVAILABLE".into());
        }
        let bot = &matches[0];
        let mut v = patch.clone();
        v["op"] = json!("update_bot_settings");
        v["bot"] = bot["id"].clone();
        v["revision"] = json!(bot["settings_revision"].as_u64().unwrap_or(0));
        self.bot_settings_action(&v, s(bot, "owner"))
    }
    pub(super) fn bot_conversation(&self, b: &Value) -> Value {
        let c = &b["conversation"];
        json!({"mode":if c["mode"]=="name_dialog"{"name_dialog"}else{"addressed"},"aliases":c["aliases"].as_array().cloned().unwrap_or_default(),"followupSeconds":c["followupSeconds"].as_u64().unwrap_or(180),"followupMessages":c["followupMessages"].as_u64().unwrap_or(8),"reactions":c["reactions"].as_bool().unwrap_or(true)})
    }
    fn bot_settings_dto(&self, b: &Value) -> Result<Value, String> {
        let user = arr(&self.db["users"])
            .into_iter()
            .find(|u| u["id"] == b["id"])
            .ok_or("BOT_SETTINGS_UNAVAILABLE")?;
        Ok(
            json!({"bot":self.bot_public(b),"profile":{"name":user["name"],"bio":user["bio"].as_str().unwrap_or(""),"avatar":user["avatar"].as_str().unwrap_or("")},"revision":b["settings_revision"].as_u64().unwrap_or(0),"conversation":self.bot_conversation(b)}),
        )
    }
    pub(super) fn bot_settings_action(&mut self, v: &Value, uid: &str) -> Result<Value, String> {
        let i = self.db["bots"]
            .as_array()
            .unwrap()
            .iter()
            .position(|b| {
                b["id"] == v["bot"]
                    && b["owner"] == uid
                    && b["enabled"] != false
                    && b["legacy"] != true
            })
            .ok_or("BOT_SETTINGS_FORBIDDEN")?;
        if !arr(&self.db["users"])
            .iter()
            .any(|u| u["id"] == uid && u["bot"] != true && u["active"] != false)
        {
            return Err("BOT_SETTINGS_FORBIDDEN".into());
        }
        let b = self.db["bots"][i].clone();
        if s(v, "op") == "get_bot_settings" {
            return self.bot_settings_dto(&b);
        }
        let revision = b["settings_revision"].as_u64().unwrap_or(0);
        if v["revision"].as_u64() != Some(revision) {
            return Err("BOT_SETTINGS_CONFLICT".into());
        }
        let next = revision.checked_add(1).ok_or("BOT_SETTINGS_CONFLICT")?;
        for key in v.as_object().ok_or("BOT_SETTINGS_INVALID")?.keys() {
            if ![
                "op",
                "bot",
                "revision",
                "profile",
                "conversation",
                "token",
                "bot_token",
                "update_id",
            ]
            .contains(&key.as_str())
            {
                return Err("BOT_SETTINGS_INVALID".into());
            }
        }
        let mut profile = json!({});
        let mut conversation = self.bot_conversation(&b);
        if let Some(p) = v.get("profile") {
            let obj = p.as_object().ok_or("BOT_SETTINGS_INVALID")?;
            for (key, value) in obj {
                let text = value.as_str().ok_or("BOT_SETTINGS_INVALID")?;
                match key.as_str() {
                    "name" => {
                        if text.trim().is_empty() || text.trim().chars().count() > 32 {
                            return Err("BOT_SETTINGS_INVALID".into());
                        }
                        profile[key] = json!(text.trim());
                    }
                    "bio" => {
                        if text.chars().count() > 512 {
                            return Err("BOT_SETTINGS_INVALID".into());
                        }
                        profile[key] = value.clone();
                    }
                    "avatar" => {
                        validate_avatar(text).map_err(|_| "BOT_SETTINGS_INVALID")?;
                        if !text.is_empty() {
                            let (_, data) = text.split_once(',').ok_or("BOT_SETTINGS_INVALID")?;
                            if base64::engine::general_purpose::STANDARD
                                .decode(data)
                                .map_err(|_| "BOT_SETTINGS_INVALID")?
                                .len()
                                > 262144
                            {
                                return Err("BOT_SETTINGS_INVALID".into());
                            }
                        }
                        profile[key] = value.clone();
                    }
                    _ => return Err("BOT_SETTINGS_INVALID".into()),
                }
            }
        }
        if let Some(c) = v.get("conversation") {
            for (key, value) in c.as_object().ok_or("BOT_SETTINGS_INVALID")? {
                match key.as_str() {
                    "mode" => {
                        if !["addressed", "name_dialog"].contains(&value.as_str().unwrap_or("")) {
                            return Err("BOT_SETTINGS_INVALID".into());
                        }
                    }
                    "aliases" => {
                        let a = value.as_array().ok_or("BOT_SETTINGS_INVALID")?;
                        let mut seen = std::collections::HashSet::new();
                        if a.len() > 20 {
                            return Err("BOT_SETTINGS_INVALID".into());
                        }
                        for alias in a {
                            let text = alias.as_str().ok_or("BOT_SETTINGS_INVALID")?;
                            if text.trim() != text
                                || text.is_empty()
                                || text.chars().count() > 64
                                || text.chars().any(char::is_control)
                                || !seen.insert(text.to_lowercase())
                            {
                                return Err("BOT_SETTINGS_INVALID".into());
                            }
                        }
                    }
                    "followupSeconds" => {
                        if value.as_u64().is_none_or(|n| n > 600) {
                            return Err("BOT_SETTINGS_INVALID".into());
                        }
                    }
                    "followupMessages" => {
                        if value.as_u64().is_none_or(|n| n > 20) {
                            return Err("BOT_SETTINGS_INVALID".into());
                        }
                    }
                    "reactions" => {
                        if !value.is_boolean() {
                            return Err("BOT_SETTINGS_INVALID".into());
                        }
                    }
                    _ => return Err("BOT_SETTINGS_INVALID".into()),
                }
                conversation[key] = value.clone();
            }
        }
        let snapshot = self.db.clone();
        let user = self.db["users"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|u| u["id"] == b["id"])
            .ok_or("BOT_SETTINGS_UNAVAILABLE")?;
        for (key, value) in profile.as_object().unwrap() {
            user[key] = value.clone();
        }
        if profile["name"].is_string() {
            self.db["bots"][i]["name"] = profile["name"].clone();
        }
        self.db["bots"][i]["conversation"] = conversation.clone();
        self.db["bots"][i]["settings_revision"] = json!(next);
        if conversation["followupSeconds"] == 0 || conversation["followupMessages"] == 0 {
            self.db["bots"][i]["followups"] = json!([]);
        }
        if conversation["mode"] != "name_dialog" {
            self.db["bots"][i]["followups"] = json!([]);
            for u in self.db["bot_updates"].as_array_mut().unwrap() {
                if u["bot"] == b["id"] && ["name", "followup"].contains(&s(u, "reason")) {
                    u["source_cancelled"] = json!(true);
                }
            }
        }
        if let Err(e) = self.save() {
            self.db = snapshot;
            return Err(e);
        }
        self.bot_settings_dto(&self.db["bots"][i])
    }
    pub(super) fn bot_invocation_management(
        &mut self,
        v: &Value,
        b: &Value,
        ui: usize,
    ) -> Result<Value, String> {
        let update = self.db["bot_updates"][ui].clone();
        self.invocation_authority(b, &update)?;
        if s(v, "op") == "bot_react" {
            if self.bot_conversation(b)["reactions"] != true {
                return Err("BOT_REACTION_DISABLED".into());
            }
            let emoji = s(v, "emoji");
            if !["👍", "❤️", "😂", "🔥", "🎉", "👀"].contains(&emoji) {
                return Err("BOT_OUTPUT_INVALID".into());
            }
            let enabled = match v.get("enabled") {
                None => true,
                Some(x) => x.as_bool().ok_or("BOT_OUTPUT_INVALID")?,
            };
            let snapshot = self.db.clone();
            let row = self.db["messages"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|m| m["id"] == update["message"]["id"])
                .ok_or("BOT_SOURCE_UNAVAILABLE")?;
            let mut reactions = arr(&row["reactions"]);
            reactions.retain(|r| !(r["user"] == b["id"] && r["emoji"] == emoji));
            if enabled {
                reactions.push(json!({"user":b["id"],"emoji":emoji}));
            }
            row["reactions"] = json!(reactions);
            let result = json!({"message":row["id"],"reactions":row["reactions"]});
            if let Err(e) = self.save() {
                self.db = snapshot;
                return Err(e);
            }
            return Ok(result);
        }
        let owner = s(b, "owner");
        if update["sender"]["id"] != owner
            || !arr(&self.db["dialogs"]).iter().any(|d| {
                d["id"] == update["channel"]
                    && arr(&d["members"]).len() == 2
                    && arr(&d["members"]).contains(&b["id"])
                    && arr(&d["members"]).contains(&json!(owner))
            })
        {
            return Err("BOT_SETTINGS_FORBIDDEN".into());
        }
        let mut request = v.clone();
        request["bot"] = b["id"].clone();
        request["op"] = json!(if s(v, "op") == "bot_get_settings" {
            "get_bot_settings"
        } else {
            "update_bot_settings"
        });
        self.bot_settings_action(&request, owner)
    }
    pub(super) fn bot_natural_reason(
        &mut self,
        index: usize,
        b: &Value,
        message: &Value,
    ) -> Option<&'static str> {
        let c = self.bot_conversation(b);
        if c["mode"] != "name_dialog" {
            return None;
        }
        let text = s(message, "text").to_lowercase();
        let mut aliases = arr(&c["aliases"]);
        aliases.push(b["name"].clone());
        let explicit = aliases
            .iter()
            .filter_map(Value::as_str)
            .filter(|a| !a.is_empty())
            .any(|a| {
                let a = a.to_lowercase();
                text.match_indices(&a).any(|(i, _)| {
                    let end = i + a.len();
                    let word = |ch: char| ch.is_alphanumeric() || ch == '_';
                    !text[..i].chars().next_back().is_some_and(word)
                        && !text[end..].chars().next().is_some_and(word)
                })
            });
        let mut sessions: Vec<Value> = arr(&self.db["bots"][index]["followups"])
            .into_iter()
            .filter(|x| {
                c["followupSeconds"].as_u64().unwrap_or(0) > 0
                    && c["followupMessages"].as_u64().unwrap_or(0) > 0
                    && x["until"].as_u64().unwrap_or(0) > now()
                    && x["remaining"].as_u64().unwrap_or(0) > 0
                    && self.bot_target_allowed(b, s(x, "channel"))
                    && self.allowed(s(x, "sender"), s(x, "channel"))
                    && arr(&self.db["users"])
                        .iter()
                        .any(|u| u["id"] == x["sender"] && u["bot"] != true && u["active"] != false)
            })
            .take(256)
            .collect();
        let pos = sessions
            .iter()
            .position(|x| x["channel"] == message["channel"] && x["sender"] == message["user"]);
        let reason = if explicit {
            if let Some(p) = pos {
                sessions.remove(p);
            }
            if c["followupSeconds"].as_u64().unwrap() > 0
                && c["followupMessages"].as_u64().unwrap() > 0
            {
                if sessions.len() >= 256 {
                    sessions.remove(0);
                }
                sessions.push(json!({"channel":message["channel"],"sender":message["user"],"until":now()+c["followupSeconds"].as_u64().unwrap(),"remaining":c["followupMessages"]}));
            }
            Some("name")
        } else if let Some(p) = pos {
            let n = sessions[p]["remaining"].as_u64().unwrap();
            sessions[p]["remaining"] = json!(n - 1);
            Some("followup")
        } else {
            None
        };
        self.db["bots"][index]["followups"] = json!(sessions);
        reason
    }
    pub(super) fn bot_followup_ack(&mut self, index: usize, ui: usize) {
        let b = self.db["bots"][index].clone();
        let u = self.db["bot_updates"][ui].clone();
        if u["done"] == true
            || !(u["response"].is_object()
                || u["responses"].as_object().is_some_and(|x| !x.is_empty()))
            || self.invocation_authority(&b, &u).is_err()
        {
            return;
        }
        let c = self.bot_conversation(&b);
        if c["mode"] != "name_dialog" {
            return;
        }
        if let Some(s) = self.db["bots"][index]["followups"]
            .as_array_mut()
            .and_then(|xs| {
                xs.iter_mut().find(|x| {
                    x["channel"] == u["channel"]
                        && x["sender"] == u["sender"]["id"]
                        && x["until"].as_u64().unwrap_or(0) > now()
                })
            })
        {
            s["until"] = json!(now() + c["followupSeconds"].as_u64().unwrap_or(180));
        }
    }
}
