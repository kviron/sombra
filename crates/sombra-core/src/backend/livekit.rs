use super::{id, now, s, Backend, Value, B64};
use base64::Engine;
use ring::hmac;
use serde_json::json;

pub(super) struct Pilot {
    pub(super) room: String,
    url: String,
    key: String,
    secret: String,
}

impl Backend {
    pub fn provision_livekit_room_offline(&mut self, group_id: &str) -> Result<String, String> {
        let group = self.db["groups"]
            .as_array_mut()
            .and_then(|groups| groups.iter_mut().find(|group| s(group, "id") == group_id))
            .ok_or("Sombra group not found")?;
        let channels = group["channels"].as_array_mut().ok_or("Invalid channels")?;
        if let Some(existing) = channels.iter().find(|channel| channel["name"] == "LiveKit") {
            if existing["kind"] != "voice" {
                return Err("A non-voice channel already uses the name LiveKit".into());
            }
            return Ok(s(existing, "id").to_string());
        }
        let room = id();
        channels.push(json!({"id":room,"name":"LiveKit","kind":"voice"}));
        self.save()?;
        Ok(room)
    }
}

impl Pilot {
    #[cfg(test)]
    pub(super) fn fixture(room: String) -> Self {
        Self {
            room,
            url: "ws://127.0.0.1:7880".into(),
            key: "devkey".into(),
            secret: "secret".into(),
        }
    }

    pub(super) fn configured() -> Result<Option<Self>, String> {
        let Ok(room) = std::env::var("MINES_LIVEKIT_ROOM") else {
            return Ok(None);
        };
        let required = |name: &str| {
            std::env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| format!("Missing {name}"))
        };
        let url = required("MINES_LIVEKIT_URL")?;
        let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid LiveKit URL")?;
        if parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || !(parsed.scheme() == "wss"
                || (parsed.scheme() == "ws"
                    && matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))))
        {
            return Err("LiveKit requires WSS or a local WS URL".into());
        }
        Ok(Some(Self {
            room,
            url,
            key: required("MINES_LIVEKIT_KEY")?,
            secret: required("MINES_LIVEKIT_SECRET")?,
        }))
    }

    pub(super) fn ticket(&self, client: &str) -> Value {
        let issued = now();
        let claims = json!({
            "iss":self.key,"sub":client,"nbf":issued,"exp":issued + 120,
            "video":{
                "room":self.room,"roomJoin":true,"canSubscribe":true,
                "canPublish":true,"canPublishSources":["microphone"],
                "canPublishData":false,"canUpdateOwnMetadata":false
            }
        });
        let signing_input = format!(
            "{}.{}",
            B64.encode(br#"{"alg":"HS256","typ":"JWT"}"#),
            B64.encode(claims.to_string())
        );
        let key = hmac::Key::new(hmac::HMAC_SHA256, self.secret.as_bytes());
        let signature = B64.encode(hmac::sign(&key, signing_input.as_bytes()));
        json!({"url":self.url,"token":format!("{signing_input}.{signature}")})
    }
}
