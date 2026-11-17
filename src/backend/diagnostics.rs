use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{Duration, Instant},
};

pub(crate) const MAX_EVENTS: usize = 200;
pub(crate) const REPORT_BATCH: usize = 8;
const REPORT_PER_MINUTE: usize = 60;

pub(crate) fn operation(name: &str) -> &'static str {
    const OPERATIONS: &[&str] = &[
        "login",
        "register",
        "me",
        "sessions",
        "revoke_session",
        "logout",
        "logout_all",
        "change_email",
        "change_password",
        "update_profile",
        "set_profile_cover",
        "profile_cover",
        "state",
        "create_group",
        "join_group",
        "save_group_role",
        "delete_group_role",
        "set_group_member_role",
        "kick_group_member",
        "leave_group",
        "rotate_group_invite",
        "set_group_member_invites",
        "update_group",
        "invite_group_member",
        "create_channel",
        "update_channel",
        "delete_channel",
        "create_dialog",
        "set_notification_preferences",
        "set_dialog_preferences",
        "message",
        "attachment_file",
        "delete_message",
        "update_message",
        "reaction",
        "friend_request",
        "friend_accept",
        "friend_remove",
        "create_bot",
        "delete_bot",
        "bot_poll",
        "bot_message",
        "bot_get_me",
        "bot_get_updates",
        "bot_ack",
        "bot_reply",
        "bot_authorize_update",
        "bot_attachment_file",
        "bot_edit",
        "bot_delete",
        "bot_typing",
        "get_bot_tool_users",
        "set_bot_tool_users",
        "get_bot_settings",
        "update_bot_settings",
        "bot_get_settings",
        "bot_update_self",
        "bot_react",
        "bot_rotate_token",
        "bot_set_commands",
        "add_bot_to_group",
        "remove_bot_from_group",
        "create_sticker",
        "sticker_image",
        "import_sticker_pack",
        "remove_sticker",
        "remove_sticker_pack",
        "voice_join",
        "voice_poll",
        "voice_signal",
        "voice_leave",
        "dialog_call_start",
        "dialog_call_decline",
        "dialog_call_cancel",
        "diagnostics_recent",
        "diagnostics_report",
        "webview",
        "voice_microphone",
        "voice_camera",
        "voice_speaker",
        "voice_playback",
    ];
    OPERATIONS
        .iter()
        .copied()
        .find(|&operation| operation == name)
        .unwrap_or("unknown")
}

pub(crate) fn desktop_runtime_category(operation: &str, category: &str) -> Option<&'static str> {
    match (operation, category) {
        ("webview", "js_error") => Some("js_error"),
        ("webview", "unhandled_rejection") => Some("unhandled_rejection"),
        ("voice_microphone" | "voice_camera" | "voice_speaker", "device_error") => {
            Some("device_error")
        }
        ("voice_microphone" | "voice_camera" | "voice_speaker", "device_permission") => {
            Some("device_permission")
        }
        ("voice_playback", "autoplay_blocked") => Some("autoplay_blocked"),
        ("voice_playback", "playback_error") => Some("playback_error"),
        _ => None,
    }
}

#[derive(Clone, Serialize)]
pub(crate) struct Event {
    time: u64,
    source: &'static str,
    operation: &'static str,
    category: &'static str,
    status: Option<u16>,
}

impl Event {
    pub(crate) fn desktop(
        operation: &'static str,
        category: &'static str,
        status: Option<u16>,
    ) -> Self {
        Self {
            time: super::now(),
            source: "desktop",
            operation,
            category,
            status,
        }
    }

    fn from_report(value: &Value) -> Option<Self> {
        let name = value["operation"].as_str()?;
        let operation = operation(name);
        if matches!(operation, "diagnostics_recent" | "diagnostics_report")
            || (operation == "unknown" && name != "unknown")
        {
            return None;
        }
        let category = value["category"].as_str()?;
        let category = match category {
            "transport" => "transport",
            "timeout" => "timeout",
            "invalid_response" => "invalid_response",
            "session_storage" => "session_storage",
            "http_error" => "http_error",
            _ => desktop_runtime_category(operation, category)?,
        };
        let status = match &value["status"] {
            Value::Null => None,
            number => Some(
                number
                    .as_u64()
                    .filter(|status| (100..=599).contains(status))? as u16,
            ),
        };
        Some(Self::desktop(operation, category, status))
    }
}

#[derive(Default)]
struct History {
    events: VecDeque<Event>,
    report_times: VecDeque<Instant>,
}

impl History {
    fn push(&mut self, event: Event, journal: bool) {
        if journal {
            eprintln!(
                "sombra_diagnostic {}",
                serde_json::to_string(&event).expect("serializable diagnostic")
            );
        }
        if self.events.len() == MAX_EVENTS {
            self.events.pop_front();
        }
        self.events.push_back(event);
    }
}

#[derive(Default)]
pub(super) struct Diagnostics(Mutex<History>);

impl Diagnostics {
    pub(super) fn server(&self, operation: &'static str, status: u16, category: &'static str) {
        if matches!(operation, "diagnostics_recent" | "diagnostics_report") && status < 500 {
            return;
        }
        if status < 400
            && matches!(
                operation,
                "state"
                    | "me"
                    | "sessions"
                    | "sticker_image"
                    | "voice_poll"
                    | "voice_signal"
                    | "bot_poll"
            )
        {
            return;
        }
        let event = Event {
            time: super::now(),
            source: "server",
            operation,
            category,
            status: Some(status),
        };
        if let Ok(mut history) = self.0.lock() {
            history.push(event, status >= 500);
        }
    }

    pub(super) fn recent(&self) -> Result<Value, String> {
        let history = self.0.lock().map_err(|_| "DIAGNOSTICS_UNAVAILABLE")?;
        Ok(json!({"events": history.events}))
    }

    pub(super) fn report(&self, value: &Value) -> Result<Value, String> {
        let events = value
            .as_array()
            .filter(|events| (1..=REPORT_BATCH).contains(&events.len()))
            .ok_or("Некорректный диагностический отчёт")?;
        let events = events
            .iter()
            .map(Event::from_report)
            .collect::<Option<Vec<_>>>()
            .ok_or("Некорректный диагностический отчёт")?;
        let mut history = self.0.lock().map_err(|_| "DIAGNOSTICS_UNAVAILABLE")?;
        let now = Instant::now();
        history
            .report_times
            .retain(|time| now.duration_since(*time) < Duration::from_secs(60));
        if history.report_times.len() + events.len() > REPORT_PER_MINUTE {
            return Err("DIAGNOSTICS_RATE_LIMIT".into());
        }
        for event in events {
            history.report_times.push_back(now);
            history.push(event, true);
        }
        Ok(json!({"ok": true}))
    }
}
