use super::*;

impl Backend {
    /// Private, normalized account settings; never part of UserDto.
    pub(super) fn chat_preferences(&self, user: &Value) -> Value {
        let stored = &user["chat_preferences"];
        let mut dialogs = serde_json::Map::new();
        if let Some(entries) = stored["dialogs"].as_object() {
            for (dialog, settings) in entries {
                if self.dialog_member(s(user, "id"), dialog) {
                    dialogs.insert(
                        dialog.clone(),
                        json!({
                            "pinned": settings["pinned"].as_bool().unwrap_or(false),
                            "muted": settings["muted"].as_bool().unwrap_or(false)
                        }),
                    );
                }
            }
        }
        json!({"revision": stored["revision"].as_u64().unwrap_or(0), "notifications": {
            "direct": stored["notifications"]["direct"].as_bool().unwrap_or(true),
            "groups": stored["notifications"]["groups"].as_bool().unwrap_or(true)
        }, "dialogs": dialogs})
    }

    pub(super) fn set_chat_preferences(
        &mut self,
        request: &Value,
        user: &Value,
    ) -> Result<Value, String> {
        let uid = s(user, "id");
        let notification = s(request, "op") == "set_notification_preferences";
        let keys = if notification {
            ["direct", "groups"]
        } else {
            ["pinned", "muted"]
        };
        let mut patch = Vec::new();
        for key in keys {
            if let Some(value) = request.get(key) {
                patch.push((
                    key,
                    value
                        .as_bool()
                        .ok_or("Некорректные настройки чата: требуется boolean")?,
                ));
            }
        }
        if patch.is_empty() {
            return Err("Укажите хотя бы одну настройку чата".into());
        }
        let mut preferences = self.chat_preferences(user);
        let target = if notification {
            &mut preferences["notifications"]
        } else {
            let dialog = request["dialog"]
                .as_str()
                .filter(|dialog| !dialog.is_empty())
                .ok_or("Укажите диалог")?;
            if !self.dialog_member(uid, dialog) {
                return Err("Нет доступа к диалогу".into());
            }
            let entries = preferences["dialogs"].as_object_mut().unwrap();
            entries
                .entry(dialog.to_owned())
                .or_insert_with(|| json!({"pinned":false,"muted":false}))
        };
        for (key, value) in patch {
            target[key] = json!(value);
        }
        preferences["revision"] = json!(preferences["revision"]
            .as_u64()
            .unwrap_or(0)
            .checked_add(1)
            .ok_or("Переполнение версии настроек")?);
        // Identity comes exclusively from the authenticated human session, never request IDs.
        let account = self.db["users"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|account| account["id"] == uid)
            .ok_or("AUTH_REQUIRED")?;
        account["chat_preferences"] = preferences.clone();
        self.save()?;
        Ok(preferences)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Backend, String, String) {
        let mut backend = Backend::open(std::env::temp_dir().join(id()).join("db.json")).unwrap();
        let owner = backend.db["users"][0].clone();
        let token = backend.token(&owner, "preferences-test", false).unwrap();
        let other =
            json!({"id":id(),"name":"Other","created_at":now(),"custom_private":"retained"});
        backend.db["users"]
            .as_array_mut()
            .unwrap()
            .push(other.clone());
        let other_token = backend.token(&other, "preferences-test", false).unwrap();
        backend.db["dialogs"] = json!([{"id":"shared","members":[owner["id"],other["id"]]}, {"id":"outside","members":[other["id"]]}]);
        backend.save().unwrap();
        (backend, token, other_token)
    }
    fn state(backend: &mut Backend, token: &str) -> Value {
        backend
            .request(json!({"op":"state","token":token}))
            .unwrap()
    }

    #[test]
    fn legacy_defaults_and_public_dto_privacy() {
        let (mut backend, token, _) = fixture();
        let result = state(&mut backend, &token);
        assert_eq!(
            result["chatPreferences"],
            json!({"revision":0,"notifications":{"direct":true,"groups":true},"dialogs":{}})
        );
        assert!(result["me"].get("chat_preferences").is_none());
        assert!(result["me"].get("chatPreferences").is_none());
        for user in result["users"].as_array().unwrap() {
            assert!(user.get("chat_preferences").is_none());
            assert!(user.get("chatPreferences").is_none());
        }
    }

    #[test]
    fn patches_merge_persist_and_remain_account_private() {
        let (mut backend, token, other_token) = fixture();
        let other_id = backend.db["users"][1]["id"].clone();
        let result = backend.request(json!({"op":"set_notification_preferences","token":token,"direct":false,"user_id":other_id,"id":other_id})).unwrap();
        assert_eq!(
            result["notifications"],
            json!({"direct":false,"groups":true})
        );
        assert_eq!(result["revision"], 1);
        backend
            .request(json!({"op":"set_notification_preferences","token":token,"groups":false}))
            .unwrap();
        backend.request(json!({"op":"set_dialog_preferences","token":token,"dialog":"shared","pinned":true})).unwrap();
        let result = backend
            .request(
                json!({"op":"set_dialog_preferences","token":token,"dialog":"shared","muted":true}),
            )
            .unwrap();
        assert_eq!(
            result["dialogs"]["shared"],
            json!({"pinned":true,"muted":true})
        );
        backend.request(json!({"op":"set_dialog_preferences","token":token,"dialog":"shared","pinned":false})).unwrap();
        backend
            .request(json!({"op":"set_notification_preferences","token":token,"direct":true}))
            .unwrap();
        let expected = json!({"revision":6,"notifications":{"direct":true,"groups":false},"dialogs":{"shared":{"pinned":false,"muted":true}}});
        assert_eq!(state(&mut backend, &token)["chatPreferences"], expected);
        let path = backend.path.clone();
        drop(backend);
        let mut reopened = Backend::open(path).unwrap();
        assert_eq!(state(&mut reopened, &token)["chatPreferences"], expected);
        assert_eq!(
            state(&mut reopened, &other_token)["chatPreferences"],
            json!({"revision":0,"notifications":{"direct":true,"groups":true},"dialogs":{}})
        );
        assert!(reopened.db["users"][1].get("chat_preferences").is_none());
        assert_eq!(reopened.db["users"][1]["custom_private"], "retained");
        let result = state(&mut reopened, &other_token);
        assert!(result["users"][0].get("chat_preferences").is_none());
    }

    #[test]
    fn rejects_nonmembers_malformed_patches_and_bot_bearers() {
        let (mut backend, token, _) = fixture();
        for dialog in [
            json!("outside"),
            json!("missing"),
            json!(""),
            json!(null),
            json!(42),
        ] {
            assert!(backend.request(json!({"op":"set_dialog_preferences","token":token,"dialog":dialog,"muted":true})).is_err());
        }
        for op in ["set_notification_preferences", "set_dialog_preferences"] {
            assert!(backend
                .request(json!({"op":op,"token":token,"dialog":"shared"}))
                .is_err());
            assert_eq!(backend.request(json!({"op":op,"token":"bot-bearer","dialog":"shared","direct":true,"muted":true})), Err("AUTH_REQUIRED".into()));
        }
        for (op, key) in [
            ("set_notification_preferences", "direct"),
            ("set_notification_preferences", "groups"),
            ("set_dialog_preferences", "pinned"),
            ("set_dialog_preferences", "muted"),
        ] {
            for invalid in [json!(null), json!("false"), json!(0), json!({}), json!([])] {
                let before = backend.db["users"].clone();
                let mut request =
                    json!({"op":op,"token":token,"dialog":"shared","direct":true,"pinned":true});
                request[key] = invalid;
                assert!(backend.request(request).is_err());
                assert_eq!(backend.db["users"], before);
            }
        }
        let bot_credentials = backend
            .provision_group_bot("LordDevil", "Preferences Bot", "preferences_bot")
            .unwrap();
        for op in ["set_notification_preferences", "set_dialog_preferences"] {
            assert_eq!(backend.request(json!({"op":op,"token":bot_credentials["token"],"dialog":"shared","direct":false,"muted":true})), Err("AUTH_REQUIRED".into()));
        }
        // Even an accidentally persisted session for a bot identity is not human auth.
        let bot = json!({"id":id(),"name":"Bot","bot":true});
        backend.db["users"]
            .as_array_mut()
            .unwrap()
            .push(bot.clone());
        let bot_token = backend.token(&bot, "bot", false).unwrap();
        assert_eq!(
            backend.request(
                json!({"op":"set_notification_preferences","token":bot_token,"direct":false})
            ),
            Err("AUTH_REQUIRED".into())
        );
    }
}
