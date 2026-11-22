use super::*;
use std::collections::HashMap;

#[cfg(test)]
mod tests;

/// Сколько последних сообщений каждого канала попадает в снапшот состояния.
/// Вся остальная история приходит страницами через `messages_page`.
pub(super) const STATE_PAGE: usize = 50;
/// Предел одной страницы истории (как в Discord: 1–100 за запрос).
pub(super) const HISTORY_LIMIT_MAX: usize = 100;
pub(super) const HISTORY_LIMIT_DEFAULT: usize = 50;

/// Последние `per_channel` сообщений каждого канала в исходном порядке.
pub(super) fn capped<'a>(visible: &[&'a Value], per_channel: usize) -> Vec<&'a Value> {
    if per_channel == 0 {
        return Vec::new();
    }
    let mut left: HashMap<&str, usize> = HashMap::new();
    for message in visible {
        left.insert(s(message, "channel"), per_channel);
    }
    let mut kept = Vec::new();
    for message in visible.iter().rev() {
        let channel = s(message, "channel");
        if let Some(remaining) = left.get_mut(channel) {
            if *remaining > 0 {
                *remaining -= 1;
                kept.push(*message);
            }
        }
    }
    kept.reverse();
    kept
}

impl Backend {
    /// Сообщения канала, видимые пользователю, в порядке вставки (он же хронологический).
    fn channel_history(&self, uid: &str, channel: &str) -> Vec<&Value> {
        self.db["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|message| {
                s(message, "channel") == channel && self.message_visible(message, uid)
            })
            .collect()
    }

    fn history_dto(&self, message: &Value, uid: &str, refs: &HashMap<&str, &Value>) -> Value {
        let mut dto = self.receipt_message(message, uid);
        Self::project_reply(&mut dto, message, refs);
        dto
    }

    /// Страница истории канала: `before` — id самого раннего уже загруженного сообщения.
    ///
    /// Курсор — идентификатор, а не время: `time` у двух сообщений может совпасть,
    /// и тогда граница страницы поплыла бы. Порядок сообщений задаёт позиция в базе.
    pub(super) fn history_page(&self, request: &Value, uid: &str) -> Result<Value, String> {
        let channel = s(request, "channel");
        if channel.is_empty() || !self.allowed(uid, channel) {
            return Err("Нет доступа к чату".into());
        }
        let limit = request["limit"]
            .as_u64()
            .unwrap_or(HISTORY_LIMIT_DEFAULT as u64)
            .clamp(1, HISTORY_LIMIT_MAX as u64) as usize;
        let before = request["before"].as_str().unwrap_or("").to_owned();

        let history = self.channel_history(uid, channel);
        let refs: HashMap<&str, &Value> = history
            .iter()
            .map(|message| (s(message, "id"), *message))
            .collect();

        let end = if before.is_empty() {
            history.len()
        } else {
            history
                .iter()
                .position(|message| s(message, "id") == before)
                // Сообщение удалили или оно вне доступа: курсор больше не действителен.
                .ok_or("HISTORY_CURSOR_INVALID")?
        };
        let start = end.saturating_sub(limit);
        let page = &history[start..end];
        let messages: Vec<Value> = page
            .iter()
            .map(|message| self.history_dto(message, uid, &refs))
            .collect();
        let next_before = page.first().map(|message| json!(s(message, "id")));
        Ok(json!({
            "messages": messages,
            "hasMore": start > 0,
            "nextBefore": if start > 0 { next_before.unwrap_or(Value::Null) } else { Value::Null }
        }))
    }

    /// Каналы, чья история длиннее страницы снапшота: клиенту есть что догружать.
    pub(super) fn channels_with_more(&self, uid: &str) -> Vec<String> {
        let mut counts: HashMap<&str, usize> = HashMap::new();
        for message in self.db["messages"].as_array().unwrap() {
            if self.message_visible(message, uid) {
                *counts.entry(s(message, "channel")).or_insert(0) += 1;
            }
        }
        let mut channels: Vec<String> = counts
            .into_iter()
            .filter(|(_, count)| *count > STATE_PAGE)
            .map(|(channel, _)| channel.to_owned())
            .collect();
        channels.sort();
        channels
    }
}
