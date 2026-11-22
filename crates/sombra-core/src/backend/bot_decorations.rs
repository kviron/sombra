//! Bot-applied profile decorations. The bot token selects the bot, and the source update selects
//! the person: the only profile a bot can decorate is the one belonging to the human who invoked
//! it. Consent is the queued invocation itself, so there is no `user`/`requester`/`owner` field.
//!
//! The document is the same strictly validated v1 format the desktop client already renders; this
//! module never reimplements those rules. Bookkeeping rides on the source update and is written in
//! the same atomic save as the decoration, so a rejected or unpersisted write consumes nothing.
use super::*;

/// Bot-token path for the `bot_set_user_decoration` operation.
pub(super) const OP: &str = "bot_set_user_decoration";
/// One-shot bookkeeping on the source update: one invocation may write decorations once.
pub(super) const APPLIED: &str = "decoration_applied";
/// One error for every malformed request or document: the rejected document is never echoed.
const INVALID: &str = "BOT_DECORATION_INVALID";
/// Every key this operation may carry. `token`/`bot_token` are injected by the HTTP layer.
const REQUEST_KEYS: &[&str] = &["op", "token", "bot_token", "update_id", "target", "decoration"];

impl Backend {
    /// Bot-token write scoped to the sender of one live invocation. The bot and the person both
    /// come from server state: the Bearer token names the bot, and `update_id` names the human who
    /// asked it. The target document is validated by [`profile_decorations::validate`], then the
    /// decoration and the consumed-update marker are persisted by a single `save`.
    pub(super) fn bot_set_user_decoration(
        &mut self,
        v: &Value,
        b: &Value,
    ) -> Result<Value, String> {
        let request = v.as_object().ok_or(INVALID)?;
        if request
            .keys()
            .any(|key| !REQUEST_KEYS.contains(&key.as_str()))
        {
            return Err(INVALID.into());
        }
        let update_id = v["update_id"].as_u64().ok_or(INVALID)?;
        // A foreign or unknown update id is refused exactly like another bot's update.
        let ui = self.db["bot_updates"]
            .as_array()
            .unwrap()
            .iter()
            .position(|u| u["bot"] == b["id"] && u["update_id"] == json!(update_id))
            .ok_or("BOT_DECORATION_FORBIDDEN")?;
        let update = self.db["bot_updates"][ui].clone();
        // Acked and already-consumed updates must never re-apply.
        if update["done"] == true || update[APPLIED] == true {
            return Err("BOT_DECORATION_CONFLICT".into());
        }
        // The sender must still be an active human who can read the source channel, and the
        // original message must be live: editing or deleting it cancels consent.
        let authority = self.invocation_authority(b, &update)?;
        let target = s(v, "target");
        if !profile_decorations::TARGETS.contains(&target) {
            return Err(INVALID.into());
        }
        let value = v.get("decoration").ok_or(INVALID)?;
        let decoration = if value.is_null() {
            None
        } else {
            Some(profile_decorations::validate(target, value).map_err(|_| INVALID)?)
        };
        // The target is always the verified sender of the update, never a request field.
        let uid = s(&authority["sender"], "id");
        let index = self.db["users"]
            .as_array()
            .unwrap()
            .iter()
            .position(|u| u["id"] == uid)
            .ok_or("BOT_SOURCE_UNAVAILABLE")?;
        let previous = self.db["users"][index].clone();
        let mut decorations = previous["decorations"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        decorations.retain(|key, _| profile_decorations::TARGETS.contains(&key.as_str()));
        match decoration {
            Some(document) => {
                decorations.insert(target.to_string(), document);
            }
            None => {
                decorations.remove(target);
            }
        }
        let snapshot = self.db.clone();
        if decorations.is_empty() {
            self.db["users"][index]
                .as_object_mut()
                .unwrap()
                .remove("decorations");
        } else {
            self.db["users"][index]["decorations"] = Value::Object(decorations);
        }
        // The marker rides on the same save as the decoration, so a rejected document or a failed
        // write leaves neither the new value nor a consumed update behind.
        effect_catalog::clear_reference(&mut self.db["users"][index], target);
        self.db["bot_updates"][ui][APPLIED] = json!(true);
        if let Err(error) = self.save() {
            self.db = snapshot;
            return Err(error);
        }
        let decorations = profile_decorations::public(&self.db["users"][index]["decorations"])
            .unwrap_or_else(|| json!({}));
        Ok(json!({"user":{"id":uid,"decorations":decorations}}))
    }
}

#[cfg(test)]
#[path = "bot_decoration_tests.rs"]
mod decoration_tests;
