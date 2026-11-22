use super::*;
pub(super) const MANAGEMENT: [&str; 12] = [
    "group.rename",
    "group.avatar",
    "channels.create_text",
    "channels.create_voice",
    "channels.rename",
    "channels.delete",
    "members.invite",
    "invite.rotate",
    "members.kick",
    "messages.delete_any",
    "stickers.manage",
    "bots.manage",
];
#[cfg(test)]
#[path = "group_roles_tests.rs"]
mod tests;
fn member() -> Value {
    json!({"id":"member","name":"Участник","permissions":[]})
}
impl Backend {
    pub(super) fn group_dto(&self, g: &Value, uid: &str) -> Value {
        let mut out = g.clone();
        let mut roles = vec![member()];
        if let Some(raw) = g["roles"].as_array() {
            for role in raw {
                let rid = s(role, "id");
                if rid.is_empty()
                    || rid == "member"
                    || rid == "owner"
                    || roles.iter().any(|r| r["id"] == rid)
                    || roles.len() >= 32
                {
                    continue;
                }
                let name = s(role, "name").trim();
                if name.is_empty() || name.chars().count() > 40 {
                    continue;
                }
                let mut permissions = Vec::new();
                for p in arr(&role["permissions"]) {
                    if p.as_str().is_some_and(|p| MANAGEMENT.contains(&p))
                        && !permissions.contains(&p)
                    {
                        permissions.push(p)
                    }
                }
                roles.push(json!({"id":rid,"name":name,"permissions":permissions}));
            }
        } else {
            roles.push(json!({"id":"admin","name":"Администратор","permissions":MANAGEMENT}));
        }
        let mut assignments = serde_json::Map::new();
        for user in arr(&g["members"]) {
            let Some(user) = user.as_str() else { continue };
            if g["owner"] == user
                || !arr(&self.db["users"])
                    .iter()
                    .any(|u| u["id"] == user && u["bot"] != true)
            {
                continue;
            }
            let role = if g["roles"].is_array() {
                s(&g["memberRoles"], user)
            } else {
                ""
            };
            if roles.iter().any(|r| r["id"] == role) {
                assignments.insert(user.into(), json!(role));
            }
        }
        let mut permissions = if self.human_member(g, uid) && g["owner"] == uid {
            json!(MANAGEMENT)
        } else if self.human_member(g, uid) {
            roles
                .iter()
                .find(|r| r["id"] == assignments.get(uid).cloned().unwrap_or(json!("member")))
                .map(|r| r["permissions"].clone())
                .unwrap_or(json!([]))
        } else {
            json!([])
        };
        let member_invites = g["member_invites"].as_bool().unwrap_or(false);
        if member_invites
            && self.human_member(g, uid)
            && !arr(&permissions).contains(&json!("members.invite"))
        {
            permissions
                .as_array_mut()
                .unwrap()
                .push(json!("members.invite"));
        }
        // Derive redaction from the computed grant set, never recurse through group_permission.
        if !arr(&permissions).contains(&json!("members.invite")) {
            out["invite"] = json!("");
        }
        out["membersCanInvite"] = json!(member_invites);
        out.as_object_mut().unwrap().remove("member_invites");
        out["roles"] = json!(roles);
        out["memberRoles"] = json!(assignments);
        out["rolesRevision"] = json!(g["roles_revision"].as_u64().unwrap_or(0));
        out["permissions"] = permissions;
        out.as_object_mut().unwrap().remove("roles_revision");
        out
    }
    fn human_member(&self, g: &Value, uid: &str) -> bool {
        arr(&g["members"]).contains(&json!(uid))
            && arr(&self.db["users"])
                .iter()
                .any(|u| u["id"] == uid && u["bot"] != true)
    }
    pub(super) fn group_permission(&self, g: &Value, uid: &str, key: &str) -> bool {
        arr(&self.group_dto(g, uid)["permissions"]).contains(&json!(key))
    }
    pub(super) fn require_group_permission(
        &self,
        gid: &str,
        uid: &str,
        key: &str,
    ) -> Result<usize, String> {
        self.db["groups"]
            .as_array()
            .unwrap()
            .iter()
            .position(|g| g["id"] == gid && self.group_permission(g, uid, key))
            .ok_or("Нет прав управления группой".into())
    }
    fn bump_group(&mut self, i: usize) {
        let revision = self.db["groups"][i]["roles_revision"].as_u64().unwrap_or(0);
        self.db["groups"][i]["roles_revision"] = json!(revision + 1);
    }
    pub(super) fn group_management(&mut self, v: &Value, uid: &str) -> Result<Value, String> {
        let op = s(v, "op");
        let i = self.db["groups"]
            .as_array()
            .unwrap()
            .iter()
            .position(|g| g["id"] == v["group"] && self.human_member(g, uid))
            .ok_or("Группа не найдена")?;
        let g = self.db["groups"][i].clone();
        if op == "rotate_group_invite" {
            self.require_group_permission(s(v, "group"), uid, "invite.rotate")?;
            self.db["groups"][i]["invite"] = json!(id());
        } else if op == "leave_group" || op == "kick_group_member" {
            let target = if op == "leave_group" {
                uid
            } else {
                s(v, "user")
            };
            if g["owner"] == target || !self.human_member(&g, target) {
                return Err("Нельзя удалить этого участника".into());
            }
            if op == "kick_group_member" {
                // The invitation baseline does not make ordinary members administrators.
                let mut role_only = g.clone();
                role_only["member_invites"] = json!(false);
                self.require_group_permission(s(v, "group"), uid, "members.kick")?;
                if target == uid
                    || (g["owner"] != uid
                        && !arr(&self.group_dto(&role_only, target)["permissions"]).is_empty())
                {
                    return Err("Нельзя удалить администратора или себя".into());
                }
            }
            self.db["groups"][i]["members"]
                .as_array_mut()
                .unwrap()
                .retain(|u| u != target);
            if let Some(map) = self.db["groups"][i]["memberRoles"].as_object_mut() {
                map.remove(target);
            }
            let rooms = arr(&g["channels"]);
            let clients: Vec<_> = self
                .voice
                .iter()
                .filter(|p| p["user"] == target && rooms.iter().any(|r| r["id"] == p["room"]))
                .map(|p| p["client"].clone())
                .collect();
            self.voice.retain(|p| !clients.contains(&p["client"]));
            self.signals
                .retain(|p| !clients.contains(&p["from"]) && !clients.contains(&p["target"]));
            self.bump_group(i);
        } else {
            if g["owner"] != uid {
                return Err("Роли изменяет только владелец".into());
            }
            let revision = v["revision"].as_u64().ok_or("Обязательна версия ролей")?;
            if revision != g["roles_revision"].as_u64().unwrap_or(0) {
                return Err("ROLES_REVISION_CONFLICT".into());
            }
            if op == "set_group_member_invites" {
                let enabled = v["enabled"]
                    .as_bool()
                    .ok_or("Некорректное значение enabled")?;
                if g["member_invites"] == true && !enabled {
                    self.db["groups"][i]["invite"] = json!(id());
                }
                self.db["groups"][i]["member_invites"] = json!(enabled);
                self.bump_group(i);
                self.save()?;
                return Ok(self.group_dto(&self.db["groups"][i], uid));
            }
            if v.get("role").is_some_and(|r| !r.is_string()) {
                return Err("Некорректный ID роли".into());
            }
            let dto = self.group_dto(&g, uid);
            let mut roles = arr(&dto["roles"]);
            let mut assignments = dto["memberRoles"].clone();
            let role = s(v, "role");
            if op == "set_group_member_role" {
                let target = s(v, "user");
                if g["owner"] == target
                    || !self.human_member(&g, target)
                    || !roles.iter().any(|r| r["id"] == role)
                {
                    return Err("Некорректный участник или роль".into());
                }
                assignments[target] = json!(role);
            } else if op == "delete_group_role" {
                if role == "member" || !roles.iter().any(|r| r["id"] == role) {
                    return Err("Роль нельзя удалить".into());
                }
                roles.retain(|r| r["id"] != role);
                for (_, value) in assignments.as_object_mut().unwrap() {
                    if *value == role {
                        *value = json!("member")
                    }
                }
            } else {
                let name = v["name"].as_str().ok_or("Некорректное имя роли")?.trim();
                if name.is_empty()
                    || name.chars().count() > 40
                    || role == "member"
                    || role == "owner"
                {
                    return Err("Некорректная роль".into());
                }
                let permissions = v["permissions"].as_array().ok_or("Нужен массив прав")?;
                let mut unique = Vec::new();
                for p in permissions {
                    if !p.as_str().is_some_and(|p| MANAGEMENT.contains(&p)) || unique.contains(p) {
                        return Err("Некорректное право".into());
                    }
                    unique.push(p.clone())
                }
                let rid = if role.is_empty() {
                    if roles.len() >= 32 {
                        return Err("Не более 32 ролей".into());
                    }
                    id()
                } else {
                    if !roles.iter().any(|r| r["id"] == role) {
                        return Err("Роль не найдена".into());
                    }
                    role.into()
                };
                roles.retain(|r| r["id"] != rid);
                roles.push(json!({"id":rid,"name":name,"permissions":unique}));
            }
            self.db["groups"][i]["roles"] = json!(roles);
            self.db["groups"][i]["memberRoles"] = assignments;
            self.bump_group(i);
        }
        self.save()?;
        Ok(self.group_dto(&self.db["groups"][i], uid))
    }
}
