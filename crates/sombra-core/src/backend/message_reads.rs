//! Exact, human-only message visibility receipts. Badge baselines are not receipts.
use super::*;
use std::collections::{HashMap, HashSet};

// Cached bot replies and historical update snapshots may contain storage clones.
// Scrub every API result as a final boundary, not only current human state DTOs.
pub(super) fn strip_internal(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            for key in ["messageSeq", "next_seq", "read_state"] {
                fields.remove(key);
            }
            for child in fields.values_mut() {
                strip_internal(child);
            }
        }
        Value::Array(rows) => {
            for row in rows {
                strip_internal(row);
            }
        }
        _ => {}
    }
}

impl Backend {
    pub(super) fn prepare_read_state(&mut self) -> Result<(), String> {
        let previous = self.db.clone();
        let result =
            self.normalize_read_sequences().and_then(
                |changed| {
                    if changed {
                        self.save()
                    } else {
                        Ok(())
                    }
                },
            );
        if result.is_err() {
            self.db = previous;
        }
        result
    }

    // Runs under Backend's existing request mutex, including for bot/legacy creators.
    // Preserve array order during the initial migration, independent of equal timestamps.
    pub(super) fn normalize_read_sequences(&mut self) -> Result<bool, String> {
        let before = self.db["read_state"].clone();
        let old_next = self.db["next_seq"].clone();
        let mut changed = false;
        let mut next = self.db["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|m| m["messageSeq"].as_u64())
            .max()
            .unwrap_or(0)
            .checked_add(1)
            .ok_or("MESSAGE_SEQUENCE_EXHAUSTED")?
            .max(self.db["next_seq"].as_u64().unwrap_or(1))
            .max(1);
        let mut used = HashSet::new();
        for message in self.db["messages"].as_array_mut().unwrap() {
            let seq = message["messageSeq"]
                .as_u64()
                .filter(|seq| *seq > 0 && used.insert(*seq));
            if seq.is_none() {
                message["messageSeq"] = json!(next);
                used.insert(next);
                next = next.checked_add(1).ok_or("MESSAGE_SEQUENCE_EXHAUSTED")?;
                changed = true;
            }
        }
        self.db["next_seq"] = json!(next);
        if !self.db["read_state"].is_object() {
            self.db["read_state"] = json!({"baselines":{},"viewers":{}});
        }
        let cutoff = next.saturating_sub(1);
        let users: Vec<String> = self.db["users"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|u| u["bot"] != true)
            .map(|u| s(u, "id").to_owned())
            .collect();
        let mut membership: HashMap<String, HashSet<String>> = HashMap::new();
        for uid in &users {
            let mut channels = HashSet::new();
            for group in self.db["groups"].as_array().unwrap() {
                if arr(&group["members"]).contains(&json!(uid)) {
                    for channel in arr(&group["channels"]) {
                        channels.insert(s(&channel, "id").to_owned());
                    }
                }
            }
            for dialog in self.db["dialogs"].as_array().unwrap() {
                if arr(&dialog["members"]).contains(&json!(uid)) {
                    channels.insert(s(dialog, "id").to_owned());
                }
            }
            membership.insert(uid.clone(), channels);
        }
        for uid in users {
            let baseline = &mut self.db["read_state"]["baselines"][&uid];
            if !baseline.is_object() {
                *baseline = json!({"global":cutoff,"channels":{}});
            }
            let channels = baseline["channels"]
                .as_object_mut()
                .ok_or("INVALID_READ_STATE")?;
            let current = &membership[&uid];
            channels.retain(|channel, _| current.contains(channel));
            for channel in current {
                channels.entry(channel.clone()).or_insert(json!(cutoff));
            }
        }
        Ok(changed || old_next != self.db["next_seq"] || before != self.db["read_state"])
    }

    fn read_viewers(&self, message: &Value) -> Vec<Value> {
        let author = s(message, "user");
        let mut viewers: Vec<Value> = self.db["read_state"]["viewers"][s(message, "id")]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(uid, time)| {
                uid.as_str() != author
                    && time.as_u64().is_some_and(|t| t > 0)
                    && !self.db["users"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|u| s(u, "id") == uid.as_str() && u["bot"] == true)
            })
            .map(|(uid, time)| json!({"user":uid,"seenAt":time}))
            .collect();
        viewers.sort_by(|a, b| {
            a["seenAt"]
                .as_u64()
                .cmp(&b["seenAt"].as_u64())
                .then_with(|| s(a, "user").cmp(s(b, "user")))
        });
        viewers
    }

    pub(super) fn receipt_message(&self, message: &Value, uid: &str) -> Value {
        let mut dto = self.public_message(message);
        if message["user"] == uid && s(message, "bot_name").is_empty() {
            let readers = self.read_viewers(message);
            dto["readCount"] = json!(readers.len());
            if let Some(first) = readers.first() {
                dto["readAt"] = first["seenAt"].clone();
            }
        }
        dto
    }

    pub(super) fn unread_count(&self, uid: &str, channel: &str) -> usize {
        let baseline = &self.db["read_state"]["baselines"][uid];
        let cutoff = baseline["channels"][channel]
            .as_u64()
            .or_else(|| baseline["global"].as_u64())
            .unwrap_or(0);
        self.db["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|message| {
                s(message, "channel") == channel
                    && message["user"] != uid
                    && message["messageSeq"].as_u64().unwrap_or(0) > cutoff
                    && self.message_visible(message, uid)
                    && self.db["read_state"]["viewers"][s(message, "id")][uid]
                        .as_u64()
                        .is_none()
            })
            .count()
    }

    pub(super) fn receipt_dialog(&self, mut dialog: Value, uid: &str) -> Value {
        dialog["unreadCount"] = json!(self.unread_count(uid, s(&dialog, "id")));
        dialog
    }

    pub(super) fn message_reads_action(&mut self, v: &Value, uid: &str) -> Result<Value, String> {
        if s(v, "op") == "message_readers" {
            let mid = v["message"]
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or("INVALID_READ_REQUEST")?;
            let message = self.db["messages"]
                .as_array()
                .unwrap()
                .iter()
                .find(|m| {
                    m["id"] == mid
                        && m["user"] == uid
                        && s(m, "bot_name").is_empty()
                        && self.message_visible(m, uid)
                })
                .ok_or("MESSAGE_READ_FORBIDDEN")?;
            return Ok(json!({"readers":self.read_viewers(message)}));
        }
        let channel = v["channel"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or("INVALID_READ_REQUEST")?;
        let ids = v["messages"]
            .as_array()
            .filter(|ids| (1..=100).contains(&ids.len()))
            .ok_or("INVALID_READ_REQUEST")?;
        if !self.allowed(uid, channel) {
            return Err("MESSAGE_READ_FORBIDDEN".into());
        }
        let mut incoming = HashSet::new();
        // Validate the complete batch before any write; never use a client sequence or actor.
        for id in ids {
            let mid = id
                .as_str()
                .filter(|id| !id.is_empty() && id.len() <= 200)
                .ok_or("INVALID_READ_REQUEST")?;
            let message = self.db["messages"]
                .as_array()
                .unwrap()
                .iter()
                .find(|m| {
                    m["id"] == mid && s(m, "channel") == channel && self.message_visible(m, uid)
                })
                .ok_or("MESSAGE_READ_FORBIDDEN")?;
            if message["user"] != uid {
                incoming.insert(mid.to_owned());
            }
        }
        let timestamp = now();
        let mut changed = false;
        for mid in incoming {
            let readers = &mut self.db["read_state"]["viewers"][&mid];
            if !readers.is_object() {
                *readers = json!({});
            }
            if readers[uid].is_null() {
                readers[uid] = json!(timestamp);
                changed = true;
            }
        }
        if changed {
            self.save()?;
        }
        Ok(json!({"ok":true}))
    }
}

#[cfg(test)]
#[path = "message_reads_tests.rs"]
mod tests;
