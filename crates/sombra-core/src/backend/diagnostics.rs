use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{Duration, Instant},
};

pub const MAX_EVENTS: usize = 200;
pub const REPORT_BATCH: usize = 8;
const REPORT_PER_MINUTE: usize = 60;

pub fn operation(name: &str) -> &'static str {
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
        "set_profile_decoration",
        "list_profile_effects",
        "create_profile_effect",
        "upload_profile_effect",
        "profile_effect_file",
        "apply_profile_effect",
        "publish_profile_effect",
        "unpublish_profile_effect",
        "state",
        "avatar_file",
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
        "forward_message",
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
        "bot_set_user_decoration",
        "create_profile_effect_draft",
        "get_profile_effect_draft",
        "bot_claim_profile_effect_draft",
        "bot_finish_profile_effect_draft",
        "get_bot_tool_users",
        "set_bot_tool_users",
        "get_bot_settings",
        "update_bot_settings",
        "bot_get_model_settings",
        "bot_update_settings",
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
        "list_public_sticker_packs",
        "set_sticker_pack_public",
        "install_public_sticker_pack",
        "remove_installed_sticker_pack",
        "remove_sticker",
        "remove_sticker_pack",
        "voice_join",
        "voice_poll",
        "voice_signal",
        "voice_leave",
        "music_state",
        "music_command",
        "music_file",
        "music_stream_chunk",
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
        "voice_transport",
        "voice_output",
    ];
    OPERATIONS
        .iter()
        .copied()
        .find(|&operation| operation == name)
        .unwrap_or("unknown")
}

pub fn desktop_runtime_category(operation: &str, category: &str) -> Option<&'static str> {
    match (operation, category) {
        ("webview", "js_error") => Some("js_error"),
        ("webview", "unhandled_rejection") => Some("unhandled_rejection"),
        ("webview", "render_error") => Some("render_error"),
        ("voice_microphone" | "voice_camera" | "voice_speaker", "device_error") => {
            Some("device_error")
        }
        ("voice_microphone" | "voice_camera" | "voice_speaker", "device_permission") => {
            Some("device_permission")
        }
        ("voice_playback", "autoplay_blocked") => Some("autoplay_blocked"),
        ("voice_playback", "playback_error") => Some("playback_error"),
        ("voice_transport", category) => [
            "ice_checking",
            "ice_connected",
            "ice_disconnected",
            "ice_failed",
            "path_direct",
            "path_relay",
            "audio_receive_stalled",
            "audio_receive_recovered",
            "audio_send_stalled",
            "audio_send_recovered",
            "audio_send_silent",
            "audio_send_silent_recovered",
            "audio_receive_silent",
            "audio_receive_silent_recovered",
        ]
        .into_iter()
        .find(|allowed| *allowed == category),
        ("voice_output", category) => [
            "mic_muted",
            "mic_unmuted",
            "output_deafened",
            "output_undeafened",
            "playback_failed",
            "output_device_failed",
            "input_device_failed",
            "mic_silent",
            "mic_silent_recovered",
        ]
        .into_iter()
        .find(|allowed| *allowed == category),
        _ => None,
    }
}

#[derive(Clone, Serialize)]
pub struct Event {
    time: u64,
    source: &'static str,
    operation: &'static str,
    category: &'static str,
    status: Option<u16>,
}

impl Event {
    pub fn desktop(operation: &'static str, category: &'static str, status: Option<u16>) -> Self {
        Self {
            time: super::now(),
            source: "desktop",
            operation,
            category,
            status,
        }
    }

    fn from_report(value: &Value) -> Option<Self> {
        Self::validated_desktop(
            super::now(),
            value["operation"].as_str()?,
            value["category"].as_str()?,
            &value["status"],
        )
    }

    pub fn from_local_line(line: &[u8]) -> Option<Self> {
        #[derive(serde::Deserialize)]
        struct Row {
            time: u64,
            source: String,
            operation: String,
            category: String,
            status: Value,
        }
        if line.iter().find(|byte| !byte.is_ascii_whitespace()) != Some(&b'{') {
            return None;
        }
        let row: Row = serde_json::from_slice(line).ok()?;
        if row.source != "desktop" {
            return None;
        }
        Self::validated_desktop(row.time, &row.operation, &row.category, &row.status)
    }

    pub fn timestamp(&self) -> u64 {
        self.time
    }

    fn validated_desktop(time: u64, name: &str, category: &str, status: &Value) -> Option<Self> {
        let operation = operation(name);
        if matches!(operation, "diagnostics_recent" | "diagnostics_report")
            || (operation == "unknown" && name != "unknown")
        {
            return None;
        }
        let category = match category {
            "transport" => "transport",
            "timeout" => "timeout",
            "invalid_response" => "invalid_response",
            "session_storage" => "session_storage",
            "http_error" => "http_error",
            _ => desktop_runtime_category(operation, category)?,
        };
        let status = match status {
            Value::Null => None,
            number => Some(
                number
                    .as_u64()
                    .filter(|status| (100..=599).contains(status))? as u16,
            ),
        };
        Some(Self {
            time,
            source: "desktop",
            operation,
            category,
            status,
        })
    }
}

#[derive(Default)]
struct History {
    events: VecDeque<Event>,
    report_times: VecDeque<Instant>,
}

impl History {
    fn push(&mut self, event: Event) {
        if self.events.len() == MAX_EVENTS {
            self.events.pop_front();
        }
        self.events.push_back(event);
    }
}

#[derive(Default)]
pub(super) struct Diagnostics {
    history: Mutex<History>,
    file: Option<crate::diagnostic_file::Sink>,
}

impl Diagnostics {
    pub(super) fn with_file(directory: std::path::PathBuf) -> Self {
        Self {
            history: Mutex::default(),
            file: Some(crate::diagnostic_file::Sink::start(directory)),
        }
    }

    fn persist(&self, event: &Event) {
        if let Some(file) = &self.file {
            file.record(event);
        }
    }

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
        let voice = matches!(
            operation,
            "voice_join" | "voice_leave" | "voice_poll" | "voice_signal"
        );
        if status >= 500
            || (voice && (status >= 400 || matches!(operation, "voice_join" | "voice_leave")))
        {
            self.persist(&event);
        }
        if let Ok(mut history) = self.history.lock() {
            history.push(event);
        }
    }

    pub(super) fn recent(&self) -> Result<Value, String> {
        let history = self.history.lock().map_err(|_| "DIAGNOSTICS_UNAVAILABLE")?;
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
        let mut history = self.history.lock().map_err(|_| "DIAGNOSTICS_UNAVAILABLE")?;
        let now = Instant::now();
        history
            .report_times
            .retain(|time| now.duration_since(*time) < Duration::from_secs(60));
        if history.report_times.len() + events.len() > REPORT_PER_MINUTE {
            return Err("DIAGNOSTICS_RATE_LIMIT".into());
        }
        for event in events {
            history.report_times.push_back(now);
            self.persist(&event);
            history.push(event);
        }
        Ok(json!({"ok": true}))
    }
}

#[cfg(test)]
mod file_tests {
    use super::*;

    #[test]
    fn voice_runtime_reports_are_allowlisted_and_strip_details() {
        let report = json!({"operation":"voice_transport","category":"path_relay","address":"private","peer":"private"});
        let event = serde_json::to_value(Event::from_report(&report).unwrap()).unwrap();
        assert_eq!(event["category"], "path_relay");
        assert!(event["status"].is_null());
        assert!(!event.to_string().contains("private"));
        for (operation, category) in [
            ("voice_output", "path_relay"),
            ("voice_transport", "192.168.1.1"),
            ("voice_poll", "ice_failed"),
        ] {
            assert!(
                Event::from_report(&json!({"operation":operation,"category":category})).is_none()
            );
        }
    }

    #[test]
    fn outbound_silence_reports_are_allowlisted() {
        // Added so one-way audio can be told apart from packet loss in the journal.
        for category in ["audio_send_silent", "audio_send_silent_recovered"] {
            let event =
                Event::from_report(&json!({"operation":"voice_transport","category":category}))
                    .unwrap();
            assert_eq!(event.category, category);
        }
    }

    #[test]
    fn server_file_keeps_voice_context_and_validated_reports() {
        let directory = std::env::temp_dir().join(format!(
            "sombra-server-diagnostics-{}",
            uuid::Uuid::new_v4()
        ));
        let diagnostics = Diagnostics::with_file(directory.clone());
        diagnostics.server("voice_poll", 200, "ok");
        diagnostics.server("voice_signal", 200, "ok");
        diagnostics.server("voice_join", 200, "ok");
        diagnostics.server("voice_leave", 200, "ok");
        diagnostics.server("voice_poll", 403, "forbidden");
        diagnostics.server("create_group", 500, "storage");
        diagnostics.server("login", 401, "auth_required");
        assert!(diagnostics
            .report(&json!([{"operation":"private operation","category":"transport"}]))
            .is_err());
        diagnostics.report(&json!([{"time":1,"source":"private source","operation":"voice_signal","category":"transport","message":"private body"}])).unwrap();
        let records = std::fs::read_to_string(directory.join("diagnostics.jsonl")).unwrap();
        assert!(!records.contains("private"));
        let records: Vec<Value> = records
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(
            records
                .iter()
                .map(|row| row["operation"].as_str().unwrap())
                .collect::<Vec<_>>(),
            [
                "voice_join",
                "voice_leave",
                "voice_poll",
                "create_group",
                "voice_signal"
            ]
        );
        assert_eq!(records[2]["status"], 403);
        assert_eq!(records[4]["source"], "desktop");
        assert_ne!(records[4]["time"], 1);
        drop(diagnostics);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[cfg(test)]
mod client_contract {
    use super::desktop_runtime_category;

    /// Клиент отправляет эти пары; оболочка обязана их принимать, иначе запись
    /// молча отбрасывается и журнал диагностики остаётся пустым.
    const PAIRS: &[(&str, &str)] = &[
        ("webview", "js_error"),
        ("webview", "unhandled_rejection"),
        ("webview", "render_error"),
        ("voice_microphone", "device_error"),
        ("voice_microphone", "device_permission"),
        ("voice_camera", "device_error"),
        ("voice_camera", "device_permission"),
        ("voice_speaker", "device_error"),
        ("voice_speaker", "device_permission"),
        ("voice_playback", "autoplay_blocked"),
        ("voice_playback", "playback_error"),
        ("voice_transport", "ice_checking"),
        ("voice_transport", "ice_connected"),
        ("voice_transport", "ice_disconnected"),
        ("voice_transport", "ice_failed"),
        ("voice_transport", "path_direct"),
        ("voice_transport", "path_relay"),
        ("voice_transport", "audio_receive_stalled"),
        ("voice_transport", "audio_receive_recovered"),
        ("voice_transport", "audio_send_stalled"),
        ("voice_transport", "audio_send_recovered"),
        ("voice_transport", "audio_send_silent"),
        ("voice_transport", "audio_send_silent_recovered"),
        ("voice_transport", "audio_receive_silent"),
        ("voice_transport", "audio_receive_silent_recovered"),
        ("voice_output", "mic_muted"),
        ("voice_output", "mic_unmuted"),
        ("voice_output", "output_deafened"),
        ("voice_output", "output_undeafened"),
        ("voice_output", "playback_failed"),
        ("voice_output", "output_device_failed"),
        ("voice_output", "input_device_failed"),
        ("voice_output", "mic_silent"),
        ("voice_output", "mic_silent_recovered"),
    ];

    #[test]
    fn every_client_category_is_accepted() {
        for (operation, category) in PAIRS {
            assert_eq!(
                desktop_runtime_category(operation, category),
                Some(*category),
                "оболочка отклонит {operation}/{category}"
            );
        }
    }
}
