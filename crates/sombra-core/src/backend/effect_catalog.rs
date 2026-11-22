//! Human-owned profile effects. Grants and equipped snapshots are persisted together.
#[path = "effect_asset.rs"]
mod effect_asset;
use super::*;

#[cfg(test)]
#[path = "effect_catalog_tests.rs"]
mod tests;

const ITEMS: &str = "profile_effects";
const GRANTS: &str = "profile_effect_grants";
const REFS: &str = "profile_effect_refs";
const INVALID: &str = "PROFILE_EFFECT_INVALID";
const NOT_FOUND: &str = "PROFILE_EFFECT_NOT_FOUND";
const LIMIT: &str = "PROFILE_EFFECT_LIMIT";
const MAX_OWNED: usize = 100;
const MAX_GRANTED: usize = 300;
const MAX_ITEMS: usize = 10_000;
const PAGE_SIZE: u64 = 30;
const BLOB_HASHES: &str = "profile_effect_blob_hashes";
const MAX_UPLOADS_PER_OWNER: usize = 10;
const MAX_UPLOADS: usize = 250;

fn equipped_asset<'a>(items: &'a Value, user: &Value, target: &str) -> Option<&'a Value> {
    if user["bot"] == true || user["active"] == false {
        return None;
    }
    let id = user[REFS][target].as_str()?;
    let item = items.get(id)?;
    (item["target"] == target && item["asset"]["id"] == id && item["asset"]["mime"] == "image/gif")
        .then_some(&item["asset"])
}

pub(super) fn title(value: &Value) -> Result<&str, &'static str> {
    let title = value.as_str().ok_or(INVALID)?.trim();
    if title.is_empty() || title.chars().count() > 80 || title.chars().any(char::is_control) {
        return Err(INVALID);
    }
    Ok(title)
}

fn valid_target(value: &Value) -> Result<&str, &'static str> {
    let target = value.as_str().ok_or(INVALID)?;
    profile_decorations::TARGETS
        .contains(&target)
        .then_some(target)
        .ok_or(INVALID)
}

fn keys(v: &Value, allowed: &[&str]) -> Result<(), &'static str> {
    v.as_object()
        .filter(|v| {
            v.keys().all(|key| {
                matches!(key.as_str(), "op" | "token" | "bot_token")
                    || allowed.contains(&key.as_str())
            })
        })
        .map(|_| ())
        .ok_or(INVALID)
}

fn has_grant(user: &Value, id: &str) -> bool {
    user[GRANTS]
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item == id))
}

pub(super) fn clear_reference(user: &mut Value, target: &str) {
    if let Some(refs) = user.get_mut(REFS).and_then(Value::as_object_mut) {
        refs.remove(target);
        if refs.is_empty() {
            user.as_object_mut().unwrap().remove(REFS);
        }
    }
}

impl Backend {
    pub(super) fn profile_effect_assets(&self, user: &Value) -> Option<Value> {
        let assets: serde_json::Map<String, Value> = profile_decorations::TARGETS
            .iter()
            .filter_map(|&target| {
                equipped_asset(&self.db[ITEMS], user, target)
                    .map(|asset| (target.to_owned(), asset.clone()))
            })
            .collect();
        (!assets.is_empty()).then_some(Value::Object(assets))
    }

    /// Rendered snapshots continue to appear after unpublish. Only the corresponding catalog ID
    /// is withheld; a viewer cannot recover it via a user's equipped private snapshot.
    pub(super) fn effect_references(
        &self,
        user: &Value,
        viewer: &str,
        decorations: &Value,
    ) -> Option<Value> {
        let mut out = serde_json::Map::new();
        for &target in profile_decorations::TARGETS {
            let Some(id) = user[REFS][target].as_str() else {
                continue;
            };
            let item = &self.db[ITEMS][id];
            let own = !viewer.is_empty() && user["id"] == viewer;
            if item["target"] == target
                && (item["public"] == true
                    || own && (item["ownerId"] == viewer || has_grant(user, id)))
                && !decorations[target].is_null()
                && decorations[target] == item["decoration"]
            {
                out.insert(target.to_string(), json!(id));
            }
        }
        (!out.is_empty()).then_some(Value::Object(out))
    }

    pub(super) fn effect_catalog_request(&mut self, v: &Value) -> Result<Value, String> {
        // Local desktop uses its session token; HTTP injects it from the human cookie only.
        let user = self.authenticate(s(v, "token"))?;
        let uid = s(&user, "id");
        let op = s(v, "op");
        if op == "list_profile_effects" {
            keys(v, &["scope", "target", "offset", "limit"])?;
            let target = valid_target(&v["target"])?;
            let scope = s(v, "scope");
            if !matches!(scope, "personal" | "catalog") {
                return Err(INVALID.into());
            }
            let offset = v
                .get("offset")
                .map_or(Some(0), Value::as_u64)
                .filter(|n| *n <= MAX_ITEMS as u64)
                .ok_or(INVALID)? as usize;
            let limit = v
                .get("limit")
                .map_or(Some(PAGE_SIZE), Value::as_u64)
                .filter(|n| (1..=PAGE_SIZE).contains(n))
                .ok_or(INVALID)? as usize;
            // UUID keys are sorted by serde_json's map. Filtering occurs before pagination.
            let mut items: Vec<_> = self.db[ITEMS]
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(id, item)| {
                    item["target"] == target
                        && if scope == "catalog" {
                            item["public"] == true
                        } else {
                            item["ownerId"] == uid || has_grant(&user, id)
                        }
                })
                .skip(offset)
                .take(limit + 1)
                .map(|(_, item)| item)
                .collect();
            let next = if items.len() > limit {
                items.pop();
                Some(offset + limit)
            } else {
                None
            };
            return Ok(json!({"items":items,"nextOffset":next}));
        }

        if matches!(op, "create_profile_effect" | "upload_profile_effect") {
            let upload = op == "upload_profile_effect";
            keys(
                v,
                &[
                    "target",
                    "title",
                    if upload { "data" } else { "decoration" },
                ],
            )?;
            let target = valid_target(&v["target"])?;
            let title = title(&v["title"])?;
            if let Some(items) = self.db[ITEMS].as_object() {
                if items.len() >= MAX_ITEMS
                    || items.values().filter(|item| item["ownerId"] == uid).count() >= MAX_OWNED
                {
                    return Err(LIMIT.into());
                }
            }
            let id = id();
            let mut item = json!({"id":id,"target":target,"title":title,"decoration":null,"ownerId":uid,"public":false});
            let previous_hashes = self.db.get(BLOB_HASHES).cloned();
            let created = if upload {
                let uploads = self.db[ITEMS]
                    .as_object()
                    .into_iter()
                    .flat_map(|items| items.values());
                if uploads.clone().filter(|i| i["asset"].is_object()).count() >= MAX_UPLOADS
                    || uploads
                        .filter(|i| i["ownerId"] == uid && i["asset"].is_object())
                        .count()
                        >= MAX_UPLOADS_PER_OWNER
                {
                    return Err(LIMIT.into());
                }
                let (asset, bytes) = effect_asset::validated_gif(&id, target, &v["data"])?;
                let path = self.write_profile_effect_blob(&id, &bytes)?;
                if !self.db[BLOB_HASHES].is_object() {
                    self.db[BLOB_HASHES] = json!({});
                }
                self.db[BLOB_HASHES][&id] = json!(effect_asset::checksum(&bytes));
                item["asset"] = asset;
                Some(path)
            } else {
                item["decoration"] =
                    profile_decorations::validate(target, &v["decoration"]).map_err(|_| INVALID)?;
                None
            };
            let snapshot = self.db.get(ITEMS).cloned();
            if self.db[ITEMS].is_null() {
                self.db[ITEMS] = json!({});
            }
            self.db[ITEMS][&id] = item.clone();
            let saved = if upload {
                self.commit_profile_media()
            } else {
                self.save()
            };
            if let Err(error) = saved {
                if let Some(path) = created {
                    let _ = std::fs::remove_file(path);
                    if let Some(previous) = previous_hashes {
                        self.db[BLOB_HASHES] = previous;
                    } else {
                        self.db.as_object_mut().unwrap().remove(BLOB_HASHES);
                    }
                }
                if let Some(previous) = snapshot {
                    self.db[ITEMS] = previous;
                } else {
                    self.db.as_object_mut().unwrap().remove(ITEMS);
                }
                return Err(error);
            }
            return Ok(json!({"item":item}));
        }

        keys(v, &["id"])?;
        let id = v["id"]
            .as_str()
            .filter(|id| uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == *id))
            .ok_or(INVALID)?;
        if op == "profile_effect_file" {
            let item = &self.db[ITEMS][id];
            let asset = &item["asset"];
            if asset["id"] != id || asset["mime"] != "image/gif" {
                return Err(NOT_FOUND.into());
            }
            // state.users exposes every active human profile to authenticated sessions.
            // Match projection here, but don't expose the private catalog record itself.
            let equipped = || {
                self.db["users"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|wearer| {
                        item["target"]
                            .as_str()
                            .filter(|target| profile_decorations::TARGETS.contains(target))
                            .and_then(|target| equipped_asset(&self.db[ITEMS], wearer, target))
                            .is_some_and(|asset| asset["id"] == id)
                    })
            };
            if item["ownerId"] != uid
                && item["public"] != true
                && !has_grant(&user, id)
                && !equipped()
            {
                return Err(NOT_FOUND.into());
            }
            return self.read_profile_effect_blob(id, asset);
        }
        let item = self.db[ITEMS]
            .get(id)
            .filter(|item| item.is_object())
            .cloned()
            .ok_or(NOT_FOUND)?;
        let owner = item["ownerId"] == uid;
        let public = item["public"] == true;
        let granted = has_grant(&user, id);
        if !owner && !public && !granted {
            return Err(NOT_FOUND.into());
        }
        if op == "publish_profile_effect" || op == "unpublish_profile_effect" {
            if !owner {
                return Err("PROFILE_EFFECT_FORBIDDEN".into());
            }
            let requested = op == "publish_profile_effect";
            if requested != public {
                self.db[ITEMS][id]["public"] = json!(requested);
                if let Err(error) = self.save() {
                    self.db[ITEMS][id] = item;
                    return Err(error);
                }
            }
            return Ok(json!({"item":self.db[ITEMS][id]}));
        }
        debug_assert_eq!(op, "apply_profile_effect");
        let target = valid_target(&item["target"])?;
        let uploaded = item["asset"]["id"] == id && item["asset"]["mime"] == "image/gif";
        let doc = if uploaded {
            None
        } else {
            Some(profile_decorations::validate(target, &item["decoration"]).map_err(|_| INVALID)?)
        };
        let index = self.db["users"]
            .as_array()
            .unwrap()
            .iter()
            .position(|u| u["id"] == uid)
            .ok_or("AUTH_REQUIRED")?;
        let stored = &mut self.db["users"][index];
        if !owner && !granted {
            if stored[GRANTS]
                .as_array()
                .is_some_and(|items| items.len() >= MAX_GRANTED)
            {
                return Err(LIMIT.into());
            }
            if !stored[GRANTS].is_array() {
                stored[GRANTS] = json!([]);
            }
            stored[GRANTS].as_array_mut().unwrap().push(json!(id));
        }
        if !stored["decorations"].is_object() {
            stored["decorations"] = json!({});
        }
        if !stored[REFS].is_object() {
            stored[REFS] = json!({});
        }
        if let Some(doc) = doc {
            stored["decorations"][target] = doc;
        } else {
            stored["decorations"]
                .as_object_mut()
                .unwrap()
                .remove(target);
        }
        stored[REFS][target] = json!(id);
        if let Err(error) = self.save() {
            self.db["users"][index] = user;
            return Err(error);
        }
        Ok(json!({"item":item,"user":self.public_for(&self.db["users"][index], uid)}))
    }
}
