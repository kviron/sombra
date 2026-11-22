use super::*;

// Frontends refresh at most every two seconds; nothing is persisted across restart.
const HUMAN_TYPING_TTL: u64 = 6;

impl Backend {
    fn human_typing_dm(&self, channel: &str, user: &str, peer: Option<&str>) -> bool {
        self.db["dialogs"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|dialog| {
                if s(dialog, "id") != channel {
                    return false;
                }
                let members = arr(&dialog["members"]);
                members.len() == 2
                    && members[0] != members[1]
                    && members.contains(&json!(user))
                    && peer.map_or(true, |p| p != user && members.contains(&json!(p)))
                    && members.iter().all(|member| {
                        member.as_str().is_some_and(|uid| {
                            self.db["users"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .any(|u| u["id"] == uid && u["bot"] != true)
                                && !self.db["bots"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .any(|b| b["id"] == uid)
                        })
                    })
            })
    }

    pub(super) fn set_human_typing(&mut self, request: &Value) -> Result<Value, String> {
        let actor = self.authenticate(s(request, "token"))?;
        let uid = s(&actor, "id");
        let fields = request.as_object().ok_or("INVALID_TYPING")?;
        if actor["bot"] == true
            || fields.keys().any(|key| {
                !["op", "token", "bot_token", "channel", "active"].contains(&key.as_str())
            })
        {
            return Err("INVALID_TYPING".into());
        }
        let channel = request["channel"]
            .as_str()
            .filter(|c| !c.is_empty())
            .ok_or("INVALID_TYPING")?;
        let active = request["active"].as_bool().ok_or("INVALID_TYPING")?;
        if !self.human_typing_dm(channel, uid, None) {
            return Err("TYPING_FORBIDDEN".into());
        }
        let timestamp = now();
        self.human_typing.retain(|_, (_, until)| *until > timestamp);
        if active {
            self.human_typing.insert(
                uid.to_owned(),
                (
                    channel.to_owned(),
                    timestamp.saturating_add(HUMAN_TYPING_TTL),
                ),
            );
        } else {
            self.clear_human_typing(uid, channel);
        }
        Ok(json!({"ok":true}))
    }

    pub(super) fn clear_human_typing(&mut self, uid: &str, channel: &str) {
        if self
            .human_typing
            .get(uid)
            .is_some_and(|(current, _)| current == channel)
        {
            self.human_typing.remove(uid);
        }
    }

    // Recheck the current room and both humans on EVERY read, never trust insertion-time ACLs.
    pub(super) fn visible_human_typing(&self, caller: &str) -> Vec<Value> {
        let timestamp = now();
        self.human_typing
            .iter()
            .filter(|(user, (channel, until))| {
                *until > timestamp && self.human_typing_dm(channel, user, Some(caller))
            })
            .map(|(user, (channel, until))| json!({"user":user,"channel":channel,"until":until}))
            .collect()
    }
}

#[cfg(test)]
mod tests;
