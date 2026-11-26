//! Invocation-scoped transport only. This does not execute or grant core tools.
use super::*;
/// Display-only activity codes a worker may announce next to its typing window.
const BOT_ACTIVITIES: &[&str] = &["thinking", "tool", "image", "search", "code", "waiting"];
/// Longest accepted UI label; longer labels are refused instead of silently truncated.
const BOT_STATUS_MAX: usize = 80;
/// One typing window. A series keeps the first `started_at` while it is refreshed.
const BOT_TYPING_TTL: u64 = 8;
/// Every key `bot_typing` may carry. The HTTP layer injects `token`/`bot_token`.
const BOT_TYPING_KEYS: &[&str] = &[
    "op",
    "token",
    "bot_token",
    "update_id",
    "typing",
    "activity",
    "status",
    "until",
];
fn bot_status_valid(status: &str) -> bool {
    status.chars().count() <= BOT_STATUS_MAX && !status.chars().any(char::is_control)
}
impl Backend {
    pub(super) fn bot_policy(&self, b: &Value) -> Value {
        json!({"revision":b["tool_policy"]["revision"].as_u64().unwrap_or(0),"owner":b["owner"],"users":b["tool_policy"]["users"].as_array().cloned().unwrap_or_default()})
    }
    pub(super) fn bot_tool_users(&mut self, v: &Value, uid: &str) -> Result<Value, String> {
        let i = self.db["bots"]
            .as_array()
            .unwrap()
            .iter()
            .position(|b| b["id"] == v["bot"] && b["owner"] == uid && b["enabled"] != false)
            .ok_or("BOT_POLICY_FORBIDDEN")?;
        if !arr(&self.db["users"])
            .iter()
            .any(|u| u["id"] == uid && u["bot"] != true && u["active"] != false)
        {
            return Err("BOT_POLICY_FORBIDDEN".into());
        }
        let policy = self.bot_policy(&self.db["bots"][i]);
        if s(v, "op") == "get_bot_tool_users" {
            return Ok(policy);
        }
        if v["revision"].as_u64() != policy["revision"].as_u64() {
            return Err("BOT_POLICY_CONFLICT".into());
        }
        let users = v["users"].as_array().ok_or("BOT_POLICY_INVALID")?;
        if users.len() > 50 {
            return Err("BOT_POLICY_INVALID".into());
        }
        let mut seen = std::collections::HashSet::new();
        for user in users {
            let key = user.as_str().ok_or("BOT_POLICY_INVALID")?;
            if !seen.insert(key)
                || !arr(&self.db["users"])
                    .iter()
                    .any(|u| u["id"] == key && u["bot"] != true && u["active"] != false)
            {
                return Err("BOT_POLICY_INVALID".into());
            }
        }
        let revision = policy["revision"]
            .as_u64()
            .unwrap()
            .checked_add(1)
            .ok_or("BOT_POLICY_CONFLICT")?;
        let snapshot = self.db.clone();
        self.db["bots"][i]["tool_policy"] = json!({"revision":revision,"users":users});
        if let Err(e) = self.save() {
            self.db = snapshot;
            return Err(e);
        }
        self.bot_typing.retain(|t| t["bot"] != v["bot"]);
        Ok(self.bot_policy(&self.db["bots"][i]))
    }
    pub(super) fn invocation_authority(&self, b: &Value, u: &Value) -> Result<Value, String> {
        if u["source_cancelled"] == true {
            return Err("BOT_SOURCE_UNAVAILABLE".into());
        }
        let sender = s(&u["sender"], "id");
        let human = arr(&self.db["users"])
            .into_iter()
            .find(|x| x["id"] == sender && x["bot"] != true && x["active"] != false)
            .ok_or("BOT_SOURCE_UNAVAILABLE")?;
        if b["enabled"] == false
            || !self.bot_target_allowed(b, s(u, "channel"))
            || !self.allowed(sender, s(u, "channel"))
        {
            return Err("BOT_SOURCE_UNAVAILABLE".into());
        }
        let source = arr(&self.db["messages"])
            .into_iter()
            .find(|m| {
                m["id"] == u["message"]["id"]
                    && m["user"] == sender
                    && m["channel"] == u["channel"]
                    && self.message_visible(m, sender)
            })
            .ok_or("BOT_SOURCE_UNAVAILABLE")?;
        if source["text"] != u["message"]["text"]
            || !attachments::message_attachments(&source)
                .iter()
                .map(|m| s(m, "id"))
                .eq(attachments::message_attachments(&u["message"])
                    .iter()
                    .map(|m| s(m, "id")))
        {
            return Err("BOT_SOURCE_UNAVAILABLE".into());
        }
        let policy = self.bot_policy(b);
        Ok(
            json!({"update_id":u["update_id"],"bot_id":b["id"],"channel":u["channel"],"chat":u["chat"],"sender":{"id":human["id"],"name":human["name"]},"access":{"trusted":b["owner"]==sender||arr(&policy["users"]).contains(&json!(sender)),"policy_revision":policy["revision"]},"limits":{"text":2000,"attachment":10485760,"parts":32}}),
        )
    }
    pub(super) fn visible_bot_typing(&self, uid: &str) -> Vec<Value> {
        if !arr(&self.db["users"])
            .iter()
            .any(|u| u["id"] == uid && u["bot"] != true && u["active"] != false)
        {
            return Vec::new();
        }
        self.bot_typing
            .iter()
            .filter(|t| {
                t["until"].as_u64().unwrap_or(0) > now()
                    && self.allowed(uid, s(t, "channel"))
                    && arr(&self.db["bots"]).iter().any(|b| {
                        b["id"] == t["bot"]
                            && arr(&self.db["bot_updates"]).iter().any(|u| {
                                u["bot"] == b["id"]
                                    && u["update_id"] == t["update_id"]
                                    && u["done"] != true
                                    && self.invocation_authority(b, u).is_ok()
                            })
                    })
            })
            .map(|t| {
                let until = t["until"].as_u64().unwrap_or(0);
                json!({"bot":t["bot"],"channel":t["channel"],"until":until,"started_at":t["started_at"].as_u64().unwrap_or(until.saturating_sub(BOT_TYPING_TTL)),"activity":t["activity"].as_str().unwrap_or(""),"status":t["status"].as_str().unwrap_or("")})
            })
            .collect()
    }
    pub(super) fn scoped_bot_operation(
        &mut self,
        v: &Value,
        b: &Value,
        ui: usize,
    ) -> Result<Value, String> {
        let update = self.db["bot_updates"][ui].clone();
        let authority = self.invocation_authority(b, &update)?;
        let op = s(v, "op");
        if op == "bot_authorize_update" {
            return Ok(authority);
        }
        if op == "bot_typing" {
            for key in v.as_object().ok_or("BOT_OUTPUT_INVALID")?.keys() {
                if !BOT_TYPING_KEYS.contains(&key.as_str()) {
                    return Err("BOT_OUTPUT_INVALID".into());
                }
            }
            if v.get("typing").is_some_and(|x| !x.is_boolean()) {
                return Err("BOT_OUTPUT_INVALID".into());
            }
            let activity = v
                .get("activity")
                .map(|value| value.as_str().ok_or("BOT_OUTPUT_INVALID"))
                .transpose()?;
            if activity.is_some_and(|activity| !BOT_ACTIVITIES.contains(&activity)) {
                return Err("BOT_OUTPUT_INVALID".into());
            }
            let status = v
                .get("status")
                .map(|value| value.as_str().ok_or("BOT_OUTPUT_INVALID"))
                .transpose()?;
            if status.is_some_and(|status| !bot_status_valid(status)) {
                return Err("BOT_OUTPUT_INVALID".into());
            }
            // The window stays server-owned: a client-supplied `until` is checked but never
            // honored, so a worker can neither extend nor shorten the eight-second TTL.
            if v.get("until").is_some_and(|value| value.as_u64().is_none()) {
                return Err("BOT_OUTPUT_INVALID".into());
            }
            let timestamp = now();
            let started_at = self
                .bot_typing
                .iter()
                .filter(|t| {
                    t["bot"] == b["id"]
                        && t["update_id"] == update["update_id"]
                        && t["until"].as_u64().unwrap_or(0) > timestamp
                })
                .find_map(|t| t["started_at"].as_u64());
            self.bot_typing.retain(|t| {
                t["until"].as_u64().unwrap_or(0) > timestamp
                    && !(t["bot"] == b["id"] && t["update_id"] == update["update_id"])
            });
            if v["typing"] != false && update["done"] != true {
                let mut entry = json!({"bot":b["id"],"channel":update["channel"],"update_id":update["update_id"],"until":timestamp+BOT_TYPING_TTL,"started_at":started_at.unwrap_or(timestamp)});
                if let Some(activity) = activity {
                    entry["activity"] = json!(activity);
                }
                if let Some(status) = status {
                    entry["status"] = json!(status);
                }
                self.bot_typing.push(entry);
            }
            return Ok(json!({"ok":true}));
        }
        if op == "bot_attachment_file" {
            let meta = attachments::selected_attachment(&update["message"], v.get("attachment_id"))
                .ok_or("BOT_ATTACHMENT_UNAVAILABLE")?;
            let bytes = self.attachment_bytes(meta)
                .map_err(|_| "BOT_ATTACHMENT_UNAVAILABLE")?;
            let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
            let expected = if update["attachment_digests"].is_object() {
                Some(update["attachment_digests"][s(meta, "id")].as_str().ok_or("BOT_ATTACHMENT_UNAVAILABLE")?)
            } else {
                update["attachment_digest"].as_str()
            };
            if expected.is_some_and(|expected| expected != token_hash(&encoded)) {
                return Err("BOT_ATTACHMENT_UNAVAILABLE".into());
            }
            return Ok(json!({"name":meta["name"],"mime":meta["mime"],"data":encoded}));
        }
        if v.get("channel").is_some() {
            return Err("BOT_OUTPUT_INVALID".into());
        }
        let key = match v.get("response_key") {
            None => "main",
            Some(k) => k.as_str().ok_or("BOT_OUTPUT_INVALID")?,
        };
        if key.is_empty()
            || key.len() > 64
            || !key
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        {
            return Err("BOT_OUTPUT_INVALID".into());
        }
        if !update["responses"].is_null() && !update["responses"].is_object() {
            return Err("BOT_RESPONSE_UNAVAILABLE".into());
        }
        let mut entries = update["responses"].as_object().cloned().unwrap_or_default();
        if entries.values().any(|e| {
            !e.is_object()
                || !e["message"]["id"].is_string()
                || (!e["payload_hash"].is_string() && !e["payload"].is_object())
        }) {
            return Err("BOT_RESPONSE_UNAVAILABLE".into());
        }
        if !entries.contains_key("main") && update["response"].is_object() {
            entries.insert("main".into(),json!({"message":update["response"],"payload":{"text":update["response"]["text"],"attachment":Value::Null},"revision":0,"deleted":false}));
        }
        let existing = entries.get(key).cloned();
        let snapshot = self.db.clone();
        let mut attachment = Value::Null;
        let result = (|| -> Result<Value, String> {
            if op == "bot_reply" {
                let text = match v.get("text") {
                    None => "",
                    Some(t) => t.as_str().ok_or("BOT_OUTPUT_INVALID")?,
                };
                if text.chars().count() > 2000 || (text.is_empty() && v["attachment"].is_null()) {
                    return Err("BOT_OUTPUT_LIMIT".into());
                }
                let payload = json!({"text":text,"attachment":v["attachment"]});
                let payload_hash = token_hash(&payload.to_string());
                if let Some(ref old) = existing {
                    if old["payload_hash"] != payload_hash && old["payload"] != payload {
                        return Err("BOT_RESPONSE_CONFLICT".into());
                    }
                    return Ok(old["message"].clone());
                }
                if entries.len() >= 32 {
                    return Err("BOT_OUTPUT_LIMIT".into());
                }
                if !v["attachment"].is_null() {
                    attachment = self.store_attachment(&v["attachment"]).map_err(|e| {
                        if e == "STORAGE_UNAVAILABLE" {
                            e
                        } else {
                            "BOT_OUTPUT_LIMIT".into()
                        }
                    })?;
                }
                let total: u64 = entries
                    .values()
                    .map(|e| e["message"]["attachment"]["size"].as_u64().unwrap_or(0))
                    .sum();
                if total + attachment["size"].as_u64().unwrap_or(0) > 20971520 {
                    return Err("BOT_OUTPUT_LIMIT".into());
                }
                let mut m = json!({"id":id(),"channel":update["channel"],"user":b["id"],"bot_name":b["name"],"text":text,"time":now(),"revision":0});
                m["mentions"] = self.canonical_mentions(s(&update, "channel"), text, None)?;
                if attachment.is_object() {
                    m["attachment"] = attachment.clone()
                }
                self.db["messages"].as_array_mut().unwrap().push(m.clone());
                entries.insert(
                    key.into(),
                    json!({"message":m,"payload_hash":payload_hash,"revision":0,"deleted":false}),
                );
            } else {
                let old = entries.get_mut(key).ok_or("BOT_RESPONSE_CONFLICT")?;
                let mi = self.db["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .position(|m| {
                        m["id"] == old["message"]["id"]
                            && m["user"] == b["id"]
                            && m["channel"] == update["channel"]
                    });
                if op == "bot_delete" {
                    if old["deleted"] == true {
                        return Ok(json!({"ok":true,"deleted":true}));
                    }
                    let mi = mi.ok_or("BOT_RESPONSE_CONFLICT")?;
                    self.db["messages"].as_array_mut().unwrap().remove(mi);
                    old["deleted"] = json!(true);
                } else if op == "bot_edit" {
                    if v.get("attachment").is_some() {
                        return Err("BOT_OUTPUT_INVALID".into());
                    }
                    if old["deleted"] == true {
                        return Err("BOT_RESPONSE_CONFLICT".into());
                    }
                    let text = v["text"].as_str().ok_or("BOT_OUTPUT_INVALID")?;
                    if text.chars().count() > 2000
                        || (text.is_empty() && old["message"]["attachment"].is_null())
                    {
                        return Err("BOT_OUTPUT_LIMIT".into());
                    }
                    let revision = v["revision"].as_u64().ok_or("BOT_RESPONSE_CONFLICT")?;
                    let current = old["revision"].as_u64().unwrap_or(0);
                    if revision == current && old["message"]["text"] == text {
                        return Ok(old["message"].clone());
                    }
                    if Some(revision) != current.checked_add(1) {
                        return Err("BOT_RESPONSE_CONFLICT".into());
                    }
                    let mi = mi.ok_or("BOT_RESPONSE_CONFLICT")?;
                    let mentions = self.canonical_mentions(s(&update, "channel"), text, None)?;
                    self.db["messages"][mi]["text"] = json!(text);
                    self.db["messages"][mi]["mentions"] = mentions;
                    self.db["messages"][mi]["revision"] = json!(revision);
                    old["message"] = self.db["messages"][mi].clone();
                    old["revision"] = json!(revision);
                } else {
                    return Err("BOT_OUTPUT_INVALID".into());
                }
            }
            self.db["bot_updates"][ui]["responses"] = json!(entries);
            if key == "main" {
                self.db["bot_updates"][ui]["response"] = entries[key]["message"].clone()
            }
            self.save()?;
            if op == "bot_delete" {
                Ok(json!({"ok":true,"deleted":true}))
            } else {
                Ok(entries[key]["message"].clone())
            }
        })();
        if result.is_err() {
            self.db = snapshot;
            if let Some(path) = self.attachment_path(&attachment) {
                let _ = std::fs::remove_file(path);
            }
        }
        result
    }
}

#[cfg(test)]
#[path = "bot_activity_tests.rs"]
mod activity_tests;
