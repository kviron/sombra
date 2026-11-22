//! Owner-chosen model identifiers only. Provider, credentials and the list of allowed
//! models stay in the Hermes plugin; the server accepts an arbitrary safe identifier and
//! an empty string means "plugin default".
use super::*;
#[cfg(test)]
#[path = "bot_model_settings_tests.rs"]
mod tests;
/// Separators a provider/model identifier may legitimately use. Whitespace, quotes,
/// backslashes and every non-ASCII byte stay rejected.
const MODEL_CHARSET: &[u8] = b"-_.:/@+";
const MODEL_MAX: usize = 120;
const REASONING: &[&str] = &["", "low", "medium", "high"];
const REQUEST_KEYS: &[&str] = &[
    "op",
    "bot",
    "token",
    "bot_token",
    "revision",
    "model",
    "reasoning",
];
const READ_OP: &str = "bot_get_model_settings";
/// Bot-token path for the owner's `/model` command. The token selects the bot, so no
/// request field can ever target another bot.
pub(super) const OWNER_OP: &str = "bot_owner_update_settings";
/// Bookkeeping on the source update: one owner-authored update may apply settings once.
pub(super) const OWNER_APPLIED: &str = "owner_settings_applied";
const OWNER_REQUEST_KEYS: &[&str] = &[
    "op",
    "token",
    "bot_token",
    "update_id",
    "model",
    "reasoning",
    "revision",
];
fn valid_model(model: &str) -> bool {
    model.len() <= MODEL_MAX
        && model
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || MODEL_CHARSET.contains(&byte))
}
impl Backend {
    /// Safe projection for owners and for `state`: identifiers only, never provider data.
    pub(super) fn bot_model_settings(&self, b: &Value) -> Value {
        let settings = &b["settings"];
        let model = settings["model"].as_str().unwrap_or("");
        let reasoning = settings["reasoning"].as_str().unwrap_or("");
        json!({"model":model,"reasoning":if REASONING.contains(&reasoning){reasoning}else{""},"revision":settings["revision"].as_u64().unwrap_or(0),"modelDefault":model.is_empty(),"reasoningDefault":reasoning.is_empty()})
    }
    fn bot_model_settings_dto(&self, i: usize) -> Value {
        let b = &self.db["bots"][i];
        let mut dto = self.bot_model_settings(b);
        dto["bot"] = b["id"].clone();
        dto
    }
    /// Human owner cookie only. A bot token selects no owner and can never reach this path.
    pub(super) fn bot_model_settings_action(
        &mut self,
        v: &Value,
        uid: &str,
    ) -> Result<Value, String> {
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
        for key in v.as_object().ok_or("BOT_SETTINGS_INVALID")?.keys() {
            if !REQUEST_KEYS.contains(&key.as_str()) {
                return Err("BOT_SETTINGS_INVALID".into());
            }
        }
        if s(v, "op") == READ_OP {
            return Ok(self.bot_model_settings_dto(i));
        }
        let revision = self.bot_model_settings(&self.db["bots"][i])["revision"]
            .as_u64()
            .unwrap_or(0);
        if v.get("revision").is_some() && v["revision"].as_u64() != Some(revision) {
            return Err("BOT_SETTINGS_CONFLICT".into());
        }
        // Validate every supplied field before touching the record: a rejected patch changes nothing.
        let mut next = self.db["bots"][i]["settings"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        let mut touched = false;
        if let Some(value) = v.get("model") {
            let model = value.as_str().ok_or("BOT_SETTINGS_INVALID")?;
            if !valid_model(model) {
                return Err("BOT_SETTINGS_INVALID".into());
            }
            next.insert("model".into(), json!(model));
            touched = true;
        }
        if let Some(value) = v.get("reasoning") {
            let reasoning = value.as_str().ok_or("BOT_SETTINGS_INVALID")?;
            if !REASONING.contains(&reasoning) {
                return Err("BOT_SETTINGS_INVALID".into());
            }
            next.insert("reasoning".into(), json!(reasoning));
            touched = true;
        }
        if !touched {
            return Err("BOT_SETTINGS_INVALID".into());
        }
        next.insert(
            "revision".into(),
            json!(revision.checked_add(1).ok_or("BOT_SETTINGS_CONFLICT")?),
        );
        let snapshot = self.db.clone();
        self.db["bots"][i]["settings"] = json!(next);
        if let Err(e) = self.save() {
            self.db = snapshot;
            return Err(e);
        }
        Ok(self.bot_model_settings_dto(i))
    }
    /// Owner-scoped write reached with the bot's own Bearer token. Authorization is the
    /// source update itself: it must belong to this bot, still be pending, and have been
    /// authored by the bot's owner. The write then reuses the human-owner path verbatim,
    /// including its validation, CAS revision and rollback.
    pub(super) fn bot_owner_update_settings(
        &mut self,
        v: &Value,
        b: &Value,
    ) -> Result<Value, String> {
        for key in v.as_object().ok_or("BOT_SETTINGS_INVALID")?.keys() {
            if !OWNER_REQUEST_KEYS.contains(&key.as_str()) {
                return Err("BOT_SETTINGS_INVALID".into());
            }
        }
        let update_id = v["update_id"].as_u64().ok_or("BOT_SETTINGS_INVALID")?;
        // A foreign or unknown update id is refused exactly like another owner's bot.
        let ui = self.db["bot_updates"]
            .as_array()
            .unwrap()
            .iter()
            .position(|u| u["bot"] == b["id"] && u["update_id"] == json!(update_id))
            .ok_or("BOT_SETTINGS_FORBIDDEN")?;
        let update = self.db["bot_updates"][ui].clone();
        // Acked and already-consumed updates must never re-apply: one owner command, one write.
        if update["done"] == true || update[OWNER_APPLIED] == true {
            return Err("BOT_SETTINGS_CONFLICT".into());
        }
        if s(&update["sender"], "id") != s(b, "owner") {
            return Err("BOT_SETTINGS_FORBIDDEN".into());
        }
        // The owner's source must still be a live invocation, exactly like the sibling
        // owner-scoped bot operations.
        self.invocation_authority(b, &update)?;
        let mut request = json!({"op":"bot_update_settings","bot":b["id"]});
        for key in ["model", "reasoning", "revision"] {
            if let Some(value) = v.get(key) {
                request[key] = value.clone();
            }
        }
        let snapshot = self.db.clone();
        // The marker rides on the same save as the settings, so a rejected patch or a failed
        // write leaves neither the new value nor a consumed update behind.
        self.db["bot_updates"][ui][OWNER_APPLIED] = json!(true);
        let result = self.bot_model_settings_action(&request, s(b, "owner"));
        if result.is_err() {
            self.db = snapshot;
        }
        result
    }
}

#[cfg(test)]
#[path = "bot_owner_settings_tests.rs"]
mod owner_tests;
