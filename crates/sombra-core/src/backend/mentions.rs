//! Canonical mentions: immutable IDs with half-open UTF-16 offsets in stored text.
//! Reads never resolve names or migrate history. Proposals are hints, not authority.
use super::*;
use std::collections::{BTreeMap, HashMap, HashSet};

fn before_ok(text: &str, start: usize) -> bool {
    text[..start].chars().next_back().is_none_or(|c| {
        c.is_whitespace()
            || matches!(
                c,
                '(' | '[' | '{' | '>' | '\'' | '"' | ',' | ';' | ':' | '!' | '?'
            )
    })
}
fn after_ok(text: &str, end: usize) -> bool {
    text[end..]
        .chars()
        .next()
        .is_none_or(|c| !c.is_alphanumeric() && !matches!(c, '_' | '-' | '@'))
}

// Conservative Markdown exclusion. Mask complete code spans/fences, brackets and
// link destinations, HTML/autolinks and URL tokens; never manufacture rich text.
fn excluded(text: &str) -> Vec<bool> {
    let bytes = text.as_bytes();
    let mut mask = vec![false; bytes.len()];
    let mut i = 0;
    while i < bytes.len() {
        let start = i;
        if bytes[i] == b'`' || (bytes[i] == b'~' && bytes.get(i..i + 3) == Some(b"~~~")) {
            let marker = bytes[i];
            let mut n = 1;
            while bytes.get(i + n) == Some(&marker) {
                n += 1;
            }
            let delimiter = &text[i..i + n];
            let end = text[i + n..]
                .find(delimiter)
                .map(|p| i + n + p + n)
                .unwrap_or(bytes.len());
            mask[start..end].fill(true);
            i = end;
            continue;
        }
        if bytes[i] == b'[' || bytes[i] == b'<' {
            let close = if bytes[i] == b'[' { b']' } else { b'>' };
            if let Some(p) = bytes[i + 1..].iter().position(|c| *c == close) {
                i += p + 2;
                if close == b']' && bytes.get(i) == Some(&b'(') {
                    let mut depth = 1;
                    i += 1;
                    while i < bytes.len() && depth > 0 {
                        if bytes[i] == b'(' {
                            depth += 1;
                        }
                        if bytes[i] == b')' {
                            depth -= 1;
                        }
                        i += 1;
                    }
                }
                mask[start..i].fill(true);
                continue;
            }
        }
        i += 1;
    }
    let mut offset = 0;
    for token in text.split_inclusive(char::is_whitespace) {
        if token.contains("://") || token.starts_with("www.") {
            mask[offset..offset + token.len()].fill(true);
        }
        offset += token.len();
    }
    mask
}

impl Backend {
    pub(super) fn canonical_mentions(
        &self,
        channel: &str,
        text: &str,
        proposed: Option<&Value>,
    ) -> Result<Value, String> {
        let blocked = excluded(text);
        // Include the complete alias union, not username priority: a login must
        // never steal another participant's identically spelled display name.
        let mut aliases: HashMap<String, HashSet<String>> = HashMap::new();
        for user in self.db["users"].as_array().unwrap() {
            if !self.allowed(s(user, "id"), channel) {
                continue;
            }
            for field in ["username", "name"] {
                let alias = s(user, field);
                if alias.is_empty() || alias.trim() != alias || alias.contains(['\n', '\r', '@']) {
                    continue;
                }
                aliases
                    .entry(format!("@{alias}"))
                    .or_default()
                    .insert(s(user, "id").to_owned());
            }
        }
        let mut candidates: BTreeMap<(usize, usize), HashSet<String>> = BTreeMap::new();
        for (start, ch) in text.char_indices() {
            if ch != '@' || !before_ok(text, start) || blocked[start] {
                continue;
            }
            for (alias, users) in &aliases {
                let end = start + alias.len();
                if text[start..].starts_with(alias)
                    && after_ok(text, end)
                    && !blocked[start..end].iter().any(|b| *b)
                {
                    candidates
                        .entry((start, end))
                        .or_default()
                        .extend(users.iter().cloned());
                }
            }
        }
        let mut explicit = BTreeMap::new();
        if let Some(value) = proposed {
            let rows = value
                .as_array()
                .filter(|r| r.len() <= 100)
                .ok_or("INVALID_MENTIONS")?;
            let utf16: HashMap<usize, usize> = text
                .char_indices()
                .map(|(i, _)| (text[..i].encode_utf16().count(), i))
                .chain(std::iter::once((text.encode_utf16().count(), text.len())))
                .collect();
            let mut previous_end = 0;
            for row in rows {
                let start = row["start"]
                    .as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .and_then(|n| utf16.get(&n).copied())
                    .ok_or("INVALID_MENTIONS")?;
                let end = row["end"]
                    .as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .and_then(|n| utf16.get(&n).copied())
                    .ok_or("INVALID_MENTIONS")?;
                let uid = row["userId"].as_str().ok_or("INVALID_MENTIONS")?;
                if start < previous_end
                    || start >= end
                    || !candidates
                        .get(&(start, end))
                        .is_some_and(|users| users.contains(uid))
                {
                    return Err("INVALID_MENTIONS".into());
                }
                explicit.insert((start, end), uid.to_owned());
                previous_end = end;
            }
        }
        let mut selected: Vec<(usize, usize, String)> = explicit
            .iter()
            .map(|(&(a, b), u)| (a, b, u.clone()))
            .collect();
        for (&(start, end), users) in &candidates {
            if users.len() != 1 || selected.iter().any(|(a, b, _)| start < *b && end > *a) {
                continue;
            }
            // Prefer the full literal alias, never a prefix of a longer name.
            if candidates.keys().any(|&(a, b)| a == start && b > end) {
                continue;
            }
            selected.push((start, end, users.iter().next().unwrap().clone()));
        }
        selected.sort_by_key(|(start, _, _)| *start);
        Ok(json!(selected.into_iter().map(|(start,end,user)| json!({"userId":user,"start":text[..start].encode_utf16().count(),"end":text[..end].encode_utf16().count()})).collect::<Vec<_>>()))
    }

    // Single pass per viewer state, using precisely the existing badge baseline
    // and exact receipt IDs, not timestamps, inferred reads or sender metadata.
    pub(super) fn unread_mention_counts(&self, uid: &str) -> HashMap<String, usize> {
        let mut counts = HashMap::new();
        let baseline = &self.db["read_state"]["baselines"][uid];
        for message in self.db["messages"].as_array().unwrap() {
            let channel = s(message, "channel");
            let cutoff = baseline["channels"][channel]
                .as_u64()
                .or_else(|| baseline["global"].as_u64())
                .unwrap_or(0);
            if message["user"] != uid
                && message["messageSeq"].as_u64().unwrap_or(0) > cutoff
                && self.db["read_state"]["viewers"][s(message, "id")][uid]
                    .as_u64()
                    .is_none()
                && message["mentions"]
                    .as_array()
                    .is_some_and(|rows| rows.iter().any(|r| r["userId"] == uid))
                && self.message_visible(message, uid)
            {
                *counts.entry(channel.to_owned()).or_insert(0) += 1;
            }
        }
        counts
    }
}

#[cfg(test)]
#[path = "mentions_tests.rs"]
mod tests;
