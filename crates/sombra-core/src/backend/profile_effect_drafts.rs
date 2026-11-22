//! Private, persisted generation lane. It never publishes or applies an effect.
#[cfg(test)]
#[path = "profile_effect_drafts_tests.rs"]
mod tests;
use super::*;

pub(super) const CREATE: &str = "create_profile_effect_draft";
pub(super) const GET: &str = "get_profile_effect_draft";
pub(super) const CLAIM: &str = "bot_claim_profile_effect_draft";
pub(super) const FINISH: &str = "bot_finish_profile_effect_draft";
const KEY: &str = "profile_effect_drafts";
const INVALID: &str = "PROFILE_EFFECT_DRAFT_INVALID";
const CONFLICT: &str = "PROFILE_EFFECT_DRAFT_CONFLICT";
const RETAIN: u64 = 24 * 3600;
const DEADLINE: u64 = 10 * 60;
const LEASE: u64 = 120;
const ATTEMPTS: u64 = 2;

pub(super) fn configured_bot() -> Option<String> {
    std::env::var("MINES_PROFILE_EFFECT_DRAFT_BOT_ID")
        .ok()
        .filter(|id| uuid::Uuid::parse_str(id).is_ok())
}

fn fields(request: &Value, allowed: &[&str]) -> Result<(), String> {
    if request.as_object().is_some_and(|obj| {
        obj.keys().all(|k| {
            matches!(k.as_str(), "op" | "token" | "bot_token") || allowed.contains(&k.as_str())
        })
    }) {
        Ok(())
    } else {
        Err(INVALID.into())
    }
}

fn timestamp(draft: &Value, key: &str) -> u64 {
    draft[key].as_u64().unwrap_or_default()
}

fn status(draft: &Value, at: u64) -> &str {
    let stored = s(draft, "status");
    if matches!(stored, "ready" | "failed") {
        return stored;
    }
    if timestamp(draft, "deadline") <= at {
        return "failed";
    }
    if stored == "running" && timestamp(draft, "lease_until") <= at {
        return if timestamp(draft, "attempts") >= ATTEMPTS {
            "failed"
        } else {
            "queued"
        };
    }
    stored
}

fn project(draft: &Value, at: u64) -> Value {
    let status = status(draft, at);
    let mut out = json!({"id":draft["id"],"status":status});
    match status {
        "ready" => out["result"] = draft["result"].clone(),
        "failed" => out["error"] = json!(draft["error"].as_str().unwrap_or("expired")),
        _ => (),
    }
    out
}

fn terminal(draft: &mut Value, result: Result<Value, &str>) {
    let obj = draft.as_object_mut().unwrap();
    for key in ["prompt", "lease_hash", "lease_until", "worker_hash"] {
        obj.remove(key);
    }
    match result {
        Ok(result) => {
            obj.insert("status".into(), json!("ready"));
            obj.insert("result".into(), result);
        }
        Err(error) => {
            obj.insert("status".into(), json!("failed"));
            obj.insert("error".into(), json!(error));
        }
    }
}

fn prune(drafts: &mut Vec<Value>, at: u64) -> bool {
    let before = drafts.len();
    drafts.retain(|d| timestamp(d, "retain_until") > at);
    let mut changed = before != drafts.len();
    for draft in drafts {
        if draft["status"] != "failed" && status(draft, at) == "failed" {
            terminal(draft, Err("expired"));
            changed = true;
        }
    }
    changed
}

impl Backend {
    pub(super) fn open_profile_effect_drafts(&mut self) -> Result<(), String> {
        if self.db[KEY].is_null() {
            self.db[KEY] = json!([]);
        }
        let drafts = self.db[KEY]
            .as_array_mut()
            .ok_or("Invalid draft collection")?;
        if drafts.iter().any(|d| !d.is_object()) {
            return Err("Invalid draft record".into());
        }
        prune(drafts, now());
        Ok(())
    }

    fn draft_bot(&self) -> Option<&Value> {
        let configured = self.profile_effect_draft_bot_id.as_deref()?;
        self.db["bots"]
            .as_array()?
            .iter()
            .find(|b| b["id"] == configured && b["enabled"] == true && b["legacy"] != true)
    }

    pub(super) fn profile_effect_drafts_supported(&self, user: &Value) -> bool {
        user["bot"] != true && self.draft_bot().is_some()
    }

    pub(super) fn profile_effect_draft_user(&mut self, request: &Value) -> Result<Value, String> {
        if !s(request, "bot_token").is_empty() {
            return Err("AUTH_REQUIRED".into());
        }
        let user = self.authenticate(s(request, "token"))?;
        if user["bot"] == true {
            return Err("AUTH_REQUIRED".into());
        }
        let owner = s(&user, "id");
        let at = now();
        if request["op"] == GET {
            fields(request, &["id"])?;
            let id = request["id"].as_str().ok_or(INVALID)?;
            return self.db[KEY]
                .as_array()
                .unwrap()
                .iter()
                .find(|d| d["owner"] == owner && d["id"] == id && timestamp(d, "retain_until") > at)
                .map(|draft| project(draft, at))
                .ok_or_else(|| "PROFILE_EFFECT_DRAFT_NOT_FOUND".into());
        }
        fields(request, &["target", "prompt"])?;
        let target = s(request, "target");
        let prompt = s(request, "prompt").trim();
        if !profile_decorations::TARGETS.contains(&target)
            || prompt.is_empty()
            || prompt.chars().count() > 400
            || prompt
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        {
            return Err(INVALID.into());
        }
        let bot_id = self
            .draft_bot()
            .map(|bot| s(bot, "id").to_owned())
            .ok_or("PROFILE_EFFECT_DRAFT_DISABLED")?;
        let drafts = self.db[KEY].as_array_mut().unwrap();
        prune(drafts, at);
        let active = |d: &&Value| matches!(status(d, at), "queued" | "running");
        if drafts.len() >= 512
            || drafts.iter().filter(|d| d["owner"] == owner).count() >= 10
            || drafts.iter().filter(active).count() >= 64
            || drafts
                .iter()
                .filter(|d| d["owner"] == owner && active(d))
                .count()
                >= 2
        {
            return Err("PROFILE_EFFECT_DRAFT_LIMIT".into());
        }
        let draft = json!({"id":id(),"status":"queued","target":target,"prompt":prompt,
            "owner":owner,"bot":bot_id,"deadline":at + DEADLINE,"retain_until":at + RETAIN,"attempts":0});
        let response = project(&draft, at);
        drafts.push(draft);
        self.save()?;
        Ok(response)
    }

    pub(super) fn profile_effect_draft_worker(
        &mut self,
        request: &Value,
        bot: &Value,
    ) -> Result<Value, String> {
        if self
            .draft_bot()
            .is_none_or(|allowed| allowed["id"] != bot["id"])
        {
            return Err("PROFILE_EFFECT_DRAFT_FORBIDDEN".into());
        }
        let at = now();
        let drafts = self.db[KEY].as_array_mut().unwrap();
        if request["op"] == CLAIM {
            fields(request, &[])?;
            let changed = prune(drafts, at);
            // Keep one generation in flight for this bot; no claim exposes another lease.
            let busy = drafts
                .iter()
                .any(|d| d["bot"] == bot["id"] && status(d, at) == "running");
            if !busy {
                if let Some(d) = drafts
                    .iter_mut()
                    .find(|d| d["bot"] == bot["id"] && status(d, at) == "queued")
                {
                    let lease = id();
                    d["status"] = json!("running");
                    d["lease_hash"] = json!(token_hash(&lease));
                    d["lease_until"] = json!((at + LEASE).min(timestamp(d, "deadline")));
                    d["worker_hash"] = bot["token_hash"].clone();
                    d["attempts"] = json!(timestamp(d, "attempts") + 1);
                    let result = json!({"draft":{"id":d["id"],"target":d["target"],"prompt":d["prompt"],"lease":lease}});
                    self.save()?;
                    return Ok(result);
                }
            }
            if changed {
                self.save()?;
            }
            return Ok(json!({"draft":null}));
        }
        fields(request, &["id", "lease", "result", "error"])?;
        let id = request["id"].as_str().ok_or(INVALID)?;
        let lease = request["lease"].as_str().ok_or(INVALID)?;
        if lease.len() != 36 {
            return Err(CONFLICT.into());
        }
        let draft = drafts
            .iter_mut()
            .find(|d| d["id"] == id && d["bot"] == bot["id"])
            .ok_or(CONFLICT)?;
        let lease_hash = token_hash(lease);
        if status(draft, at) != "running"
            || draft["lease_hash"] != lease_hash
            || draft["worker_hash"] != bot["token_hash"]
        {
            return Err(CONFLICT.into());
        }
        let result = match (request.get("result"), request.get("error")) {
            (Some(result), None) => {
                let obj = result.as_object().ok_or(INVALID)?;
                if obj.len() != 2 || !obj.contains_key("title") || !obj.contains_key("decoration") {
                    return Err(INVALID.into());
                }
                let title = s(result, "title").trim();
                if title.is_empty()
                    || title.chars().count() > 64
                    || title.chars().any(char::is_control)
                {
                    return Err(INVALID.into());
                }
                let decoration =
                    profile_decorations::validate(s(draft, "target"), &result["decoration"])
                        .map_err(|_| INVALID)?;
                Ok(json!({"title":title,"decoration":decoration}))
            }
            (None, Some(error)) if error == "generation_failed" => Err("generation_failed"),
            _ => return Err(INVALID.into()),
        };
        terminal(draft, result);
        let result = project(draft, at);
        self.save()?;
        Ok(result)
    }
}
