//! Profile decorations: animated avatar frames and cover scenes are drawn by the desktop client
//! from a compact v1 JSON document. The server stores exactly that document per user — no images,
//! no executables, no URLs — and re-validates it strictly on the way in and on the way out.
//!
//! The document is untrusted input that other people's clients will render, so every string here
//! comes from a closed list (effect ids, anchors, palette names, hex colours), every number is
//! range-checked, unknown keys are refused instead of dropped, and nothing is ever executed,
//! resolved or fetched. Storage is additive: a user without `decorations` simply has none.
use super::*;

/// One error for every rejection: the document is never echoed back, neither in the response nor
/// in the diagnostics journal.
pub(super) const INVALID: &str = "PROFILE_DECORATION_INVALID";
/// Per-target cap, measured on the compact serialised document that is actually stored.
pub(super) const MAX_BYTES: usize = 4096;
const MAX_LAYERS: usize = 3;
const VERSION: u64 = 1;
pub(super) const TARGETS: &[&str] = &["avatar", "cover"];
const MODES: &[&str] = &["frame", "scene"];
const TOP_KEYS: &[&str] = &["v", "target", "mode", "loop", "seed", "layers"];
const LAYER_KEYS: &[&str] = &["effect", "palette", "anchor", "intensity", "scale", "flip"];
/// `token`/`bot_token` are the session cookie and bearer token injected by the HTTP layer; a client
/// can never address a different account, so there is deliberately no `user`/`requester_id` key.
const REQUEST_KEYS: &[&str] = &["op", "target", "decoration", "token", "bot_token"];
/// Named palettes, the same list as `NAMED_PALETTES` in `ui/shared/ui/avatar-fx/palettes.ts`.
const PALETTES: &[&str] = &[
    "aurora", "ember", "fire", "lava", "gold", "holy", "arcane", "ice", "poison", "heal", "candy",
    "neon", "cyber", "shadow", "leaf",
];
/// Anchors from `ui/shared/ui/avatar-fx/normalize.ts`; each effect only accepts a subset below.
const ANCHORS: &[&str] = &[
    "ring",
    "bottom-right",
    "bottom-left",
    "top-right",
    "top-left",
    "fill",
    "runner",
];
const SCENE_EFFECT: &str = "sombra/runner";

/// Mirrors `EFFECT_SPECS` in `ui/shared/ui/avatar-fx/presets.ts`: every vendored effect belongs to
/// one target and accepts a short list of anchors there. Anything else is refused instead of being
/// silently degraded by the renderer, so a stored document always means what it says.
fn effect_anchors(effect: &str, target: &str) -> Option<&'static [&'static str]> {
    match (effect, target) {
        ("holy/divine-shield", "avatar") => Some(&["ring"]),
        ("critters/slime", "avatar") => {
            Some(&["bottom-right", "bottom-left", "top-right", "top-left"])
        }
        ("weather/aurora", "cover") => Some(&["fill"]),
        ("sombra/runner", "cover") => Some(&["runner"]),
        _ => None,
    }
}

/// `#rgb` or `#rrggbb`, nothing else — no `rgb()`, no names, no URLs.
fn hex(value: &str) -> bool {
    value.strip_prefix('#').is_some_and(|digits| {
        matches!(digits.len(), 3 | 6) && digits.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

/// A named palette from the client's table, or a custom 3–12 entry hex ramp.
fn valid_palette(value: &Value) -> bool {
    if let Some(name) = value.as_str() {
        return PALETTES.contains(&name);
    }
    value.as_array().is_some_and(|ramp| {
        (3..=12).contains(&ramp.len()) && ramp.iter().all(|entry| entry.as_str().is_some_and(hex))
    })
}

/// `seed` is a JSON integer in the uint32 range: `1.0`, `"1"`, `-1` and `4294967296` are refused.
fn uint32(value: &Value) -> Option<u64> {
    value.as_u64().filter(|seed| *seed <= u32::MAX as u64)
}

/// Finite JSON number inside an inclusive range; booleans and strings are not numbers here.
fn between(value: &Value, min: f64, max: f64) -> bool {
    value
        .as_f64()
        .is_some_and(|number| number.is_finite() && (min..=max).contains(&number))
}

fn validate_layer(value: &Value, target: &str, scene: bool) -> Result<Value, String> {
    let layer = value.as_object().ok_or(INVALID)?;
    if layer.keys().any(|key| !LAYER_KEYS.contains(&key.as_str())) {
        return Err(INVALID.into());
    }
    let effect = layer.get("effect").and_then(Value::as_str).ok_or(INVALID)?;
    let anchors = effect_anchors(effect, target).ok_or(INVALID)?;
    // The runner is a scene character, never a frame decoration.
    if effect == SCENE_EFFECT && !scene {
        return Err(INVALID.into());
    }
    let mut out = serde_json::Map::new();
    out.insert("effect".into(), json!(effect));
    if let Some(palette) = layer.get("palette") {
        if !valid_palette(palette) {
            return Err(INVALID.into());
        }
        out.insert("palette".into(), palette.clone());
    }
    if let Some(anchor) = layer.get("anchor") {
        let anchor = anchor.as_str().ok_or(INVALID)?;
        if !ANCHORS.contains(&anchor) || !anchors.contains(&anchor) {
            return Err(INVALID.into());
        }
        out.insert("anchor".into(), json!(anchor));
    }
    for (key, min, max) in [("intensity", 0.0, 1.0), ("scale", 0.5, 2.0)] {
        if let Some(number) = layer.get(key) {
            if !between(number, min, max) {
                return Err(INVALID.into());
            }
            out.insert(key.into(), number.clone());
        }
    }
    if let Some(flip) = layer.get("flip") {
        if !flip.is_boolean() {
            return Err(INVALID.into());
        }
        out.insert("flip".into(), flip.clone());
    }
    Ok(Value::Object(out))
}

/// Strict parse of one target document. The accepted input is never stored as-is: the returned
/// value is rebuilt from the whitelisted fields, in a fixed shape, and capped at [`MAX_BYTES`].
pub(super) fn validate(target: &str, value: &Value) -> Result<Value, String> {
    // Bound the work before looking at the structure: an oversized body is refused, not parsed.
    if serde_json::to_vec(value).map_err(|_| INVALID)?.len() > MAX_BYTES {
        return Err(INVALID.into());
    }
    let document = value.as_object().ok_or(INVALID)?;
    if document.keys().any(|key| !TOP_KEYS.contains(&key.as_str())) {
        return Err(INVALID.into());
    }
    if document.get("v").and_then(Value::as_u64) != Some(VERSION) {
        return Err(INVALID.into());
    }
    if document.get("target").and_then(Value::as_str) != Some(target) {
        return Err(INVALID.into());
    }
    let scene = match document.get("mode") {
        None => false,
        Some(mode) => {
            let mode = mode.as_str().ok_or(INVALID)?;
            // `scene` replaces the whole cover with an opaque pixel scene, so the avatar target and
            // every other value stay refused.
            if !MODES.contains(&mode) || (mode == "scene" && target != "cover") {
                return Err(INVALID.into());
            }
            mode == "scene"
        }
    };
    if document
        .get("loop")
        .is_some_and(|loop_| !loop_.is_boolean())
    {
        return Err(INVALID.into());
    }
    if document
        .get("seed")
        .is_some_and(|seed| uint32(seed).is_none())
    {
        return Err(INVALID.into());
    }
    let layers = document
        .get("layers")
        .and_then(Value::as_array)
        .filter(|layers| !layers.is_empty() && layers.len() <= MAX_LAYERS)
        .ok_or(INVALID)?;
    let mut canonical = serde_json::Map::new();
    canonical.insert("v".into(), json!(VERSION));
    canonical.insert("target".into(), json!(target));
    for key in ["mode", "loop", "seed"] {
        if let Some(value) = document.get(key) {
            canonical.insert(key.into(), value.clone());
        }
    }
    let mut checked = Vec::with_capacity(layers.len());
    for layer in layers {
        checked.push(validate_layer(layer, target, scene)?);
    }
    canonical.insert("layers".into(), Value::Array(checked));
    let canonical = Value::Object(canonical);
    if serde_json::to_vec(&canonical).map_err(|_| INVALID)?.len() > MAX_BYTES {
        return Err(INVALID.into());
    }
    Ok(canonical)
}

/// Public projection: only the two known targets, each re-validated so a hand-edited or older
/// database cannot leak unexpected keys to other people's clients. `None` means "no decorations".
pub(super) fn public(value: &Value) -> Option<Value> {
    let stored = value.as_object()?;
    let mut out = serde_json::Map::new();
    for target in TARGETS {
        let Some(document) = stored.get(*target) else {
            continue;
        };
        if let Ok(canonical) = validate(target, document) {
            out.insert((*target).to_string(), canonical);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(Value::Object(out))
    }
}

impl Backend {
    /// Human session cookie only, and only ever the calling account: the request cannot name a
    /// user, so there is no path to somebody else's profile. `decoration: null` removes the
    /// document for that target; everything is validated before the record is touched, and a
    /// failed write restores the previous record.
    pub(super) fn set_profile_decoration(&mut self, v: &Value) -> Result<Value, String> {
        let user = self.authenticate(s(v, "token"))?;
        let request = v.as_object().ok_or(INVALID)?;
        if request
            .keys()
            .any(|key| !REQUEST_KEYS.contains(&key.as_str()))
        {
            return Err(INVALID.into());
        }
        let target = s(v, "target");
        if !TARGETS.contains(&target) {
            return Err(INVALID.into());
        }
        let value = v.get("decoration").ok_or(INVALID)?;
        let decoration = if value.is_null() {
            None
        } else {
            Some(validate(target, value)?)
        };
        let index = self.db["users"]
            .as_array()
            .and_then(|users| users.iter().position(|u| u["id"] == user["id"]))
            .ok_or("AUTH_REQUIRED")?;
        let previous = self.db["users"][index].clone();
        let mut decorations = previous["decorations"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        decorations.retain(|key, _| TARGETS.contains(&key.as_str()));
        match decoration {
            Some(document) => {
                decorations.insert(target.to_string(), document);
            }
            None => {
                decorations.remove(target);
            }
        }
        if decorations.is_empty() {
            self.db["users"][index]
                .as_object_mut()
                .unwrap()
                .remove("decorations");
        } else {
            self.db["users"][index]["decorations"] = Value::Object(decorations);
        }
        effect_catalog::clear_reference(&mut self.db["users"][index], target);
        if let Err(e) = self.save() {
            self.db["users"][index] = previous;
            return Err(e);
        }
        Ok(json!({"user":self.public_for(&self.db["users"][index], s(&user, "id"))}))
    }
}

#[cfg(test)]
#[path = "profile_decorations_tests.rs"]
mod tests;
