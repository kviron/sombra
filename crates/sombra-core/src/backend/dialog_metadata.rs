//! Owner-only metadata for human group DMs; no membership/ownership migration.
use super::*;
use std::io::Cursor;
const FORBIDDEN: &str = "Нет доступа к изменению диалога";
const CONFLICT: &str = "Диалог изменён. Обновите данные и повторите попытку";
const INVALID: &str = "Некорректные данные диалога";

// Keep the profile avatar contract (including clearing), but also fully decode with
// explicit bounds: valid base64 alone does not establish a safe raster image.
fn validate_dialog_avatar(avatar: &str) -> Result<(), String> {
    validate_avatar(avatar)?;
    if avatar.is_empty() {
        return Ok(());
    }
    let (prefix, encoded) = avatar.split_once(',').ok_or(INVALID)?;
    let format = match prefix {
        "data:image/png;base64" => image::ImageFormat::Png,
        "data:image/jpeg;base64" => image::ImageFormat::Jpeg,
        "data:image/webp;base64" => image::ImageFormat::WebP,
        _ => return Err("Выберите изображение PNG, JPEG или WebP до 500 КБ".into()),
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| INVALID)?;
    if bytes.len() > 500 * 1024 {
        return Err("Аватарка: до 500 КБ".into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(2048);
    limits.max_image_height = Some(2048);
    limits.max_alloc = Some(32 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| "Выберите корректное изображение для аватарки")?;
    Ok(())
}

impl Backend {
    // Read-only path bypasses read migrations and session timestamps entirely.
    pub(super) fn search_conversation_members(&self, request: &Value) -> Result<Value, String> {
        let user = self.authenticate(s(request, "token"))?;
        if !s(request, "bot_token").is_empty() {
            return Err("AUTH_REQUIRED".into());
        }
        if request
            .as_object()
            .ok_or(INVALID)?
            .keys()
            .any(|key| !["op", "token", "bot_token", "channel", "query"].contains(&key.as_str()))
        {
            return Err(INVALID.into());
        }
        let channel = request["channel"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or(INVALID)?;
        let uid = s(&user, "id");
        if !self.allowed(uid, channel) {
            return Err("Нет доступа к участникам переписки".into());
        }
        let query = request["query"]
            .as_str()
            .ok_or(INVALID)?
            .trim()
            .to_lowercase();
        if !(1..=128).contains(&query.chars().count()) || query.chars().any(char::is_control) {
            return Err("Поиск: от 1 до 128 символов".into());
        }
        let members = if let Some(dialog) = self.db["dialogs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|dialog| dialog["id"] == channel && arr(&dialog["members"]).contains(&json!(uid)))
        {
            arr(&dialog["members"])
        } else {
            self.db["groups"]
                .as_array()
                .unwrap()
                .iter()
                .find(|group| {
                    arr(&group["members"]).contains(&json!(uid))
                        && arr(&group["channels"]).iter().any(|c| c["id"] == channel)
                })
                .map(|group| arr(&group["members"]))
                .ok_or("Нет доступа к участникам переписки")?
        };
        let users: Vec<Value> = self.db["users"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|user| {
                members.contains(&user["id"])
                    && (["name", "username"]
                        .iter()
                        .any(|key| s(user, key).to_lowercase().contains(&query))
                        || (query.contains('@')
                            && !s(user, "email").is_empty()
                            && s(user, "email").trim().to_lowercase() == query))
            })
            .map(|user| self.public(user))
            .collect();
        Ok(json!({"users": users}))
    }

    pub(super) fn update_dialog_metadata(
        &mut self,
        request: &Value,
        uid: &str,
    ) -> Result<Value, String> {
        if !s(request, "bot_token").is_empty() {
            return Err("AUTH_REQUIRED".into());
        }
        let object = request.as_object().ok_or(INVALID)?;
        if object.keys().any(|key| {
            ![
                "op",
                "token",
                "bot_token",
                "dialog",
                "revision",
                "name",
                "avatar",
            ]
            .contains(&key.as_str())
        }) {
            return Err(INVALID.into());
        }
        let dialog_id = request["dialog"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or(INVALID)?;
        let index = self.db["dialogs"]
            .as_array()
            .unwrap()
            .iter()
            .position(|d| d["id"] == dialog_id)
            .ok_or(FORBIDDEN)?;
        let dialog = &self.db["dialogs"][index];
        let members = dialog["members"].as_array().ok_or(FORBIDDEN)?;
        let mut unique = std::collections::HashSet::new();
        if dialog["owner"].as_str() != Some(uid)
            || !(3..=10).contains(&members.len())
            || !members.contains(&json!(uid))
            || members.iter().any(|member| {
                let Some(member) = member.as_str() else {
                    return true;
                };
                !unique.insert(member)
                    || !arr(&self.db["users"])
                        .iter()
                        .any(|u| u["id"] == member && u["bot"] != true)
                    || arr(&self.db["bots"]).iter().any(|bot| bot["id"] == member)
            })
        {
            return Err(FORBIDDEN.into());
        }
        let expected = request["revision"]
            .as_u64()
            .ok_or("Укажите целую неотрицательную версию диалога")?;
        let revision = match dialog.get("revision") {
            None => 0,
            Some(value) => value.as_u64().ok_or(CONFLICT)?,
        };
        if expected != revision {
            return Err(CONFLICT.into());
        }
        let mut updated = dialog.clone();
        if let Some(name) = request.get("name") {
            let raw_name = name.as_str().ok_or(INVALID)?;
            let name = raw_name.trim();
            if !(1..=60).contains(&name.chars().count()) || raw_name.chars().any(char::is_control) {
                return Err("Название: от 1 до 60 символов".into());
            }
            updated["name"] = json!(name);
        }
        if let Some(avatar) = request.get("avatar") {
            validate_dialog_avatar(avatar.as_str().ok_or(INVALID)?)?;
            updated["avatar"] = avatar.clone();
        }
        if request.get("name").is_none() && request.get("avatar").is_none() {
            return Err("Укажите название или аватарку диалога".into());
        }
        updated["revision"] = json!(revision.checked_add(1).ok_or(CONFLICT)?);
        self.db["dialogs"][index] = updated.clone();
        // Backend::request restores the complete previous DB on any save failure.
        self.save()?;
        Ok(updated)
    }
}

#[cfg(test)]
#[path = "dialog_metadata_tests.rs"]
mod tests;
