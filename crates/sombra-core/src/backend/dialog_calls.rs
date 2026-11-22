use super::*;

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Backend {
        let mut b = Backend::open(
            std::env::temp_dir()
                .join(format!("sombra-calls-{}", id()))
                .join("db.json"),
        )
        .unwrap();
        b.db["dialogs"] = json!([{"id":"dialog","members":["alice","bob"],"owner":"alice"}]);
        b
    }
    fn start(b: &mut Backend, video: bool) -> Value {
        b.dialog_call_action(
            &json!({"op":"dialog_call_start","dialog":"dialog","video":video}),
            "alice",
        )
        .unwrap()
    }
    fn voice(
        b: &mut Backend,
        op: &str,
        call: &Value,
        user: &str,
        client: &str,
    ) -> Result<Value, String> {
        b.voice_action(
            &json!({"op":op,"room":call["id"],"client":client}),
            user,
            user,
        )
    }
    #[test]
    fn privacy_decline_late_join_video_and_idempotence() {
        let mut b = fixture();
        let original = b.db.clone();
        let c = start(&mut b, true);
        assert!(b
            .dialog_call_action(
                &json!({"op":"dialog_call_start","dialog":"dialog","video":false}),
                "outsider"
            )
            .is_err());
        assert!(voice(&mut b, "voice_join", &c, "outsider", &id()).is_err());
        assert_eq!(
            b.state(&json!({"id":"outsider"}), false)["dialogCalls"],
            json!([])
        );
        let a = id();
        voice(&mut b, "voice_join", &c, "alice", &a).unwrap();
        b.dialog_call_action(&json!({"op":"dialog_call_decline","call":c["id"]}), "bob")
            .unwrap();
        let reused = start(&mut b, false);
        assert_eq!(reused["id"], c["id"]);
        assert_eq!(reused["video"], true);
        assert_eq!(reused["declined"], json!(["bob"]));
        assert_eq!(reused["participants"], json!(["alice"]));
        voice(&mut b, "voice_join", &c, "bob", &id()).unwrap();
        assert_eq!(start(&mut b, false)["declined"], json!([]));
        assert!(b
            .dialog_call_action(&json!({"op":"dialog_call_cancel","call":c["id"]}), "alice")
            .is_err());
        assert_eq!(b.db, original);
    }
    #[test]
    fn capacity_is_global_per_call_and_groups_keep_eight() {
        let mut b = fixture();
        let c = start(&mut b, false);
        for _ in 0..10 {
            voice(&mut b, "voice_join", &c, "alice", &id()).unwrap();
        }
        assert!(voice(&mut b, "voice_join", &c, "bob", &id()).is_err());
        let owner = b.db["users"][0]["id"].as_str().unwrap().to_string();
        let room = b.db["groups"][0]["channels"][4]["id"].clone();
        let g = json!({"id":room});
        for _ in 0..8 {
            voice(&mut b, "voice_join", &g, &owner, &id()).unwrap();
        }
        assert!(voice(&mut b, "voice_join", &g, &owner, &id()).is_err());
        assert!(voice(&mut b, "voice_join", &g, "bob", &id()).is_err());
    }
    #[test]
    fn timestamp_cleanup_empty_reuse_restart_and_cancel() {
        let mut b = fixture();
        let c = start(&mut b, false);
        let t = now();
        b.dialog_calls[0]["empty_since"] = json!(t - 59);
        assert_eq!(start(&mut b, false)["empty_since"], json!(t - 59));
        b.cleanup_calls(t + 1);
        assert!(b.dialog_calls.is_empty());
        let c2 = start(&mut b, false);
        let client = id();
        voice(&mut b, "voice_join", &c2, "alice", &client).unwrap();
        b.voice[0]["seen"] = json!(100);
        b.cleanup_calls(125);
        assert_eq!(b.dialog_calls[0]["empty_since"], 120);
        b.cleanup_calls(179);
        assert_eq!(b.dialog_calls.len(), 1);
        b.cleanup_calls(180);
        assert!(b.dialog_calls.is_empty());
        let c3 = start(&mut b, false);
        voice(&mut b, "voice_join", &c3, "alice", &client).unwrap();
        voice(&mut b, "voice_leave", &c3, "alice", &client).unwrap();
        // A repeated/stale leave is harmless and does not renew the grace period.
        let before = b.dialog_calls[0]["empty_since"].clone();
        voice(&mut b, "voice_leave", &c3, "alice", &client).unwrap();
        assert_eq!(b.dialog_calls[0]["empty_since"], before);
        let empty = b.dialog_calls[0]["empty_since"].as_u64().unwrap();
        b.cleanup_calls(empty + 59);
        assert_eq!(b.dialog_calls.len(), 1);
        b.cleanup_calls(empty + 60);
        assert!(b.dialog_calls.is_empty());
        let c4 = start(&mut b, false);
        assert!(b
            .dialog_call_action(&json!({"op":"dialog_call_cancel","call":c4["id"]}), "bob")
            .is_err());
        b.dialog_call_action(&json!({"op":"dialog_call_cancel","call":c4["id"]}), "alice")
            .unwrap();
        assert!(b.dialog_calls.is_empty());
        start(&mut b, false);
        b.save().unwrap();
        let restarted = Backend::open(b.path.clone()).unwrap();
        assert!(restarted.dialog_calls.is_empty());
        assert!(restarted.voice.is_empty());
        assert_ne!(c["id"], c2["id"]);
    }
}

impl Backend {
    pub(super) fn dialog_member(&self, uid: &str, dialog: &str) -> bool {
        self.db["dialogs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["id"] == dialog && arr(&d["members"]).contains(&json!(uid)))
    }

    // Derive the real empty transition from expiring peers, not the next request's time.
    pub(super) fn cleanup_calls(&mut self, timestamp: u64) {
        for call in &mut self.dialog_calls {
            let peers: Vec<_> = self
                .voice
                .iter()
                .filter(|p| p["room"] == call["id"])
                .collect();
            let live = peers
                .iter()
                .any(|p| p["seen"].as_u64().unwrap_or(0).saturating_add(20) > timestamp);
            if live {
                call.as_object_mut().unwrap().remove("empty_since");
            } else if call["empty_since"].is_null() {
                let transition = peers
                    .iter()
                    .map(|p| p["seen"].as_u64().unwrap_or(0).saturating_add(20))
                    .max()
                    .unwrap_or(timestamp);
                call["empty_since"] = json!(transition);
            }
        }
        self.voice
            .retain(|p| p["seen"].as_u64().unwrap_or(0).saturating_add(20) > timestamp);
        self.music.cleanup(&self.voice);
        self.dialog_calls.retain(|c| {
            c["empty_since"]
                .as_u64()
                .is_none_or(|t| t.saturating_add(60) > timestamp)
        });
        self.signals
            .retain(|p| p["time"].as_u64().unwrap_or(0).saturating_add(30) > timestamp);
    }

    pub(super) fn call_dto(&self, call: &Value) -> Value {
        let mut dto = call.clone();
        let participants: std::collections::BTreeSet<_> = self
            .voice
            .iter()
            .filter(|p| {
                p["room"] == call["id"]
                    && p["seen"].as_u64().unwrap_or(0).saturating_add(20) > now()
            })
            .filter(|p| self.dialog_member(s(p, "user"), s(call, "dialog")))
            .map(|p| s(p, "user"))
            .collect();
        dto["participants"] = json!(participants);
        dto
    }

    pub(super) fn dialog_call_action(&mut self, v: &Value, uid: &str) -> Result<Value, String> {
        self.cleanup_calls(now());
        if v["op"] == "dialog_call_start" {
            let dialog = s(v, "dialog");
            if !self.dialog_member(uid, dialog) {
                return Err("Нет доступа к диалогу".into());
            }
            let video = v["video"].as_bool().ok_or("Укажите тип звонка")?;
            if let Some(call) = self.dialog_calls.iter().find(|c| c["dialog"] == dialog) {
                return Ok(self.call_dto(call));
            }
            let call = json!({"id":id(),"dialog":dialog,"caller":uid,"video":video,"created_at":now(),"declined":[],"empty_since":now()});
            self.dialog_calls.push(call.clone());
            return Ok(self.call_dto(&call));
        }
        let index = self
            .dialog_calls
            .iter()
            .position(|c| c["id"] == v["call"])
            .ok_or("Звонок завершён")?;
        if !self.dialog_member(uid, s(&self.dialog_calls[index], "dialog")) {
            return Err("Нет доступа к диалогу".into());
        }
        match s(v, "op") {
            "dialog_call_decline" => {
                let declined = self.dialog_calls[index]["declined"].as_array_mut().unwrap();
                if !declined.contains(&json!(uid)) {
                    declined.push(json!(uid));
                }
                Ok(self.call_dto(&self.dialog_calls[index]))
            }
            "dialog_call_cancel" => {
                let call = &self.dialog_calls[index];
                if call["caller"] != uid || self.voice.iter().any(|p| p["room"] == call["id"]) {
                    return Err("Отменить пустой звонок может только инициатор".into());
                }
                self.dialog_calls.remove(index);
                Ok(json!({}))
            }
            _ => Err("Неизвестная операция".into()),
        }
    }
}
