use super::{s, token_hash, Backend};
use serde_json::{json, Value};

fn pack_id(owner: &str, pack: &str) -> String {
    token_hash(&format!("personal-sticker-pack:{owner}:{pack}"))
}
fn sticker_pack_id(sticker: &Value) -> Option<String> {
    let pack = s(sticker, "pack");
    let owner = s(sticker, "owner");
    (!pack.is_empty() && !owner.is_empty() && s(sticker, "group").is_empty())
        .then(|| pack_id(owner, pack))
}

impl Backend {
    pub(super) fn sticker_pack_is_public(&self, sticker: &Value) -> bool {
        sticker["archived"] != true
            && sticker_pack_id(sticker)
                .is_some_and(|id| self.db["public_sticker_packs"][id]["owner"] == sticker["owner"])
    }

    pub(super) fn sticker_pack_installed(&self, sticker: &Value, uid: &str) -> bool {
        sticker_pack_id(sticker).is_some_and(|id| {
            self.db["installed_sticker_packs"][uid][id]
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item == &sticker["id"]))
        })
    }

    pub(super) fn decorate_sticker_catalog_dto(
        &self,
        original: &Value,
        uid: &str,
        dto: &mut Value,
    ) {
        let Some(id) = sticker_pack_id(original) else {
            return;
        };
        let installed = self.sticker_pack_installed(original, uid);
        dto["packId"] = json!(id);
        dto["packInstalled"] = json!(installed);
        dto["packAdded"] =
            json!(self.db["installed_sticker_packs"][uid][s(dto, "packId")].is_array());
        dto["packPublic"] = json!(self.sticker_pack_is_public(original));
        if installed {
            dto["archived"] = json!(false);
        }
    }

    fn public_pack_items(&self, row: &Value) -> Vec<&Value> {
        self.db["stickers"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|item| {
                item["owner"] == row["owner"]
                    && item["pack"] == row["pack"]
                    && s(item, "group").is_empty()
                    && item["archived"] != true
            })
            .collect()
    }

    pub(super) fn prune_empty_public_sticker_packs(&mut self, uid: &str) {
        let empty: Vec<_> = self.db["public_sticker_packs"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, row)| row["owner"] == uid && self.public_pack_items(row).is_empty())
            .map(|(key, _)| key.clone())
            .collect();
        if let Some(packs) = self.db["public_sticker_packs"].as_object_mut() {
            for key in empty {
                packs.remove(&key);
            }
        }
    }

    pub(super) fn sticker_catalog_request(
        &mut self,
        v: &Value,
        uid: &str,
    ) -> Result<Value, String> {
        if !s(v, "group").is_empty() {
            return Err("Публичный каталог доступен только для личных наборов".into());
        }
        let id = s(v, "packId");
        match s(v, "op") {
            "list_public_sticker_packs" => {
                let offset = v["offset"]
                    .as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .unwrap_or(0);
                let mut packs = self.db["public_sticker_packs"].as_object().into_iter().flatten()
                    .filter(|(key, _)| id.is_empty() || id == *key)
                    .filter_map(|(key, row)| {
                        let items = self.public_pack_items(row);
                        if items.is_empty() { return None; }
                        let count = items.len();
                        let stickers: Vec<_> = items.into_iter().take(if id.is_empty() { 4 } else { 200 }).map(|item| {
                            json!({"id":item["id"],"name":item["name"],"owner":item["owner"],"pack":item["pack"]})
                        }).collect();
                        Some(json!({"id":key,"name":row["pack"],"owner":row["owner"],"count":count,
                            "installed":self.db["installed_sticker_packs"][uid][key].is_array(), "stickers":stickers}))
                    }).skip(if id.is_empty() { offset } else { 0 }).take(25).collect::<Vec<_>>();
                let next = (packs.len() == 25).then(|| offset + 24);
                packs.truncate(24);
                return Ok(json!({"packs":packs,"nextOffset":next}));
            }
            "set_sticker_pack_public" => {
                let pack = s(v, "pack");
                let public = v["public"].as_bool().ok_or("Укажите видимость набора")?;
                let key = pack_id(uid, pack);
                if pack.is_empty() || pack.chars().count() > 60 || (!id.is_empty() && id != key) {
                    return Err("Личный набор не найден".into());
                }
                let row = json!({"owner":uid,"pack":pack});
                if public {
                    if self.public_pack_items(&row).is_empty() {
                        return Err("Личный набор не найден".into());
                    }
                    self.db["public_sticker_packs"][&key] = row;
                } else if let Some(packs) = self.db["public_sticker_packs"].as_object_mut() {
                    packs.remove(&key);
                }
            }
            "install_public_sticker_pack" => {
                if self.db["installed_sticker_packs"][uid][id].is_array() {
                    return Ok(json!({"ok":true}));
                }
                let row = &self.db["public_sticker_packs"][id];
                if !row.is_object() || row["owner"] == uid {
                    return Err("Публичный набор недоступен".into());
                }
                let ids: Vec<_> = self
                    .public_pack_items(row)
                    .into_iter()
                    .map(|item| item["id"].clone())
                    .collect();
                if ids.is_empty() {
                    return Err("Публичный набор недоступен".into());
                }
                let count: usize = self.db["installed_sticker_packs"][uid]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .filter_map(|(_, items)| items.as_array())
                    .map(Vec::len)
                    .sum();
                if count + ids.len() > 1000 {
                    return Err("Можно добавить до 1000 стикеров из каталога".into());
                }
                self.db["installed_sticker_packs"][uid][id] = json!(ids);
            }
            "remove_installed_sticker_pack" => {
                if let Some(packs) = self.db["installed_sticker_packs"][uid].as_object_mut() {
                    packs.remove(id);
                }
            }
            _ => return Err("UNKNOWN_OPERATION".into()),
        }
        self.save()?;
        Ok(json!({"ok":true}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::id;

    #[test]
    fn public_sticker_catalog_preserves_installed_snapshot_and_privacy() {
        let path = std::env::temp_dir().join(id()).join("db.json");
        let mut b = Backend::open(path.clone()).unwrap();
        let owner = b.db["users"][0].clone();
        let owner_token = json!(b.token(&owner, "test", false).unwrap());
        let mut register = |name: &str| {
            b.request(json!({"op":"register","name":name,"email":format!("{name}@example.test"),"password":"strong-password"})).unwrap()["token"].clone()
        };
        let guest = register("Guest");
        let stranger = register("Stranger");
        let call = |b: &mut Backend, token: &Value, mut req: Value| {
            req["token"] = token.clone();
            b.request(req)
        };
        let import = json!({"op":"import_sticker_pack","pack":"Same","stickers":[{"name":"One","image":"data:image/png;base64,iVBORw0KGgo="}]});
        call(&mut b, &owner_token, import.clone()).unwrap();
        call(&mut b, &guest, import.clone()).unwrap();
        let owner_state = call(
            &mut b,
            &owner_token,
            json!({"op":"state","sticker_assets":true}),
        )
        .unwrap();
        let source = &owner_state["stickers"][0];
        let pack_id = &source["packId"];
        let asset = json!({"op":"sticker_image","sticker":source["id"]});
        let list = json!({"op":"list_public_sticker_packs"});
        let publish =
            json!({"op":"set_sticker_pack_public","pack":"Same","packId":pack_id,"public":true});
        let install = json!({"op":"install_public_sticker_pack","packId":pack_id});
        assert!(b.request(list.clone()).is_err());
        assert!(call(&mut b, &stranger, asset.clone()).is_err());
        assert!(call(&mut b, &guest, install.clone()).is_err());
        assert!(call(&mut b, &guest, publish.clone()).is_err());
        let mut group_publish = publish.clone();
        group_publish["group"] = json!("group");
        assert!(call(&mut b, &owner_token, group_publish).is_err());
        call(&mut b, &owner_token, publish.clone()).unwrap();
        let catalog = call(&mut b, &guest, list.clone()).unwrap();
        assert_eq!(catalog["packs"][0]["id"], *pack_id);
        assert_eq!(catalog["packs"][0]["count"], 1);
        assert!(catalog["packs"][0]["stickers"][0]["asset"].is_null());
        assert!(call(&mut b, &stranger, asset.clone()).is_ok());
        call(&mut b, &guest, install.clone()).unwrap();
        call(&mut b, &guest, install.clone()).unwrap();
        let mut unpublish = publish.clone();
        unpublish["public"] = json!(false);
        assert!(call(&mut b, &guest, unpublish.clone()).is_err());
        call(&mut b, &owner_token, unpublish).unwrap();
        drop(b);
        let mut b = Backend::open(path.clone()).unwrap();
        assert_eq!(
            call(&mut b, &stranger, list.clone()).unwrap()["packs"],
            json!([])
        );
        assert!(call(&mut b, &stranger, asset.clone()).is_err());
        assert!(call(&mut b, &stranger, install).is_err());
        assert!(call(&mut b, &guest, asset.clone()).is_ok());
        let state = call(&mut b, &guest, json!({"op":"state","sticker_assets":true})).unwrap();
        let source = state["stickers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["packId"] == *pack_id)
            .unwrap();
        assert_eq!(source["packInstalled"], true);
        assert_eq!(source["packPublic"], false);
        assert_eq!(state["stickers"].as_array().unwrap().len(), 2);
        call(&mut b, &owner_token, publish).unwrap();
        call(
            &mut b,
            &owner_token,
            json!({"op":"remove_sticker_pack","pack":"Same"}),
        )
        .unwrap();
        assert!(call(&mut b, &guest, asset.clone()).is_ok());
        call(&mut b, &owner_token, import).unwrap();
        assert_eq!(call(&mut b, &stranger, list).unwrap()["packs"], json!([]));
        call(
            &mut b,
            &guest,
            json!({"op":"remove_installed_sticker_pack","packId":pack_id}),
        )
        .unwrap();
        assert!(call(&mut b, &guest, asset).is_err());
        drop(b);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
