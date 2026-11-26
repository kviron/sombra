use super::*;
use std::collections::HashMap;

#[cfg(test)]
mod tests;

const UNAVAILABLE: &str = "MESSAGE_REFERENCE_UNAVAILABLE";
const DISABLED: &str = "MESSAGE_REFERENCES_DISABLED";
const INVALID: &str = "MESSAGE_FORWARD_INVALID";

pub(super) fn supported() -> bool {
    std::env::var("MINES_MESSAGE_REFERENCES").as_deref() != Ok("0")
}

impl Backend {
    pub(super) fn validated_reply(
        &self,
        request: &Value,
        uid: &str,
        channel: &str,
    ) -> Result<Option<String>, String> {
        let Some(reference) = request.get("replyTo") else {
            return Ok(None);
        };
        if !supported() {
            return Err(DISABLED.into());
        }
        let reference = reference
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or(UNAVAILABLE)?;
        self.db["messages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|source| {
                source["id"] == reference
                    && source["channel"] == channel
                    && self.message_visible(source, uid)
            })
            .map(|_| Some(reference.to_owned()))
            .ok_or_else(|| UNAVAILABLE.into())
    }

    pub(super) fn project_reply(dto: &mut Value, message: &Value, visible: &HashMap<&str, &Value>) {
        let Some(reference) = message["reply_to"].as_str() else {
            return;
        };
        dto["replyTo"] = match visible
            .get(reference)
            .filter(|source| source["channel"] == message["channel"])
        {
            Some(source) => {
                json!({"id":reference,"author":source["user"],"text":s(source,"text").chars().take(200).collect::<String>()})
            }
            None => json!({"id":reference}),
        };
    }

    pub(super) fn forward_message(&mut self, request: &Value, uid: &str) -> Result<Value, String> {
        if !supported() {
            return Err(DISABLED.into());
        }
        let source_id = request["message"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or(INVALID)?;
        let target = request["channel"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or(INVALID)?;
        let comment = request
            .get("comment")
            .map(|value| value.as_str().ok_or(INVALID))
            .transpose()?
            .unwrap_or_default()
            .trim();
        if comment.chars().count() > 2000 {
            return Err(INVALID.into());
        }
        let source = self.db["messages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|message| message["id"] == source_id && self.message_visible(message, uid))
            .ok_or(UNAVAILABLE)?;
        if !self.allowed(uid, target) {
            return Err("MESSAGE_FORWARD_TARGET_UNAVAILABLE".into());
        }
        let text = s(source, "text");
        if text.trim().is_empty()
            || !attachments::message_attachments(source).is_empty()
            || !source["attachment"].is_null()
            || !s(source, "sticker").is_empty()
            || !source["gif"].is_null()
        {
            return Err("MESSAGE_FORWARD_MEDIA_UNSUPPORTED".into());
        }
        // Only copy text and original authorship, never source IDs, media, mentions,
        // reactions or nested metadata. Don't dispatch copied text as a fresh bot command.
        let author = source["forwarded_author"]
            .as_str()
            .or_else(|| source["user"].as_str())
            .ok_or(UNAVAILABLE)?;
        let forwarded = json!({"id":id(),"channel":target,"user":uid,"text":text,"sticker":"","time":now(),"mentions":[],"forwarded_author":author});
        let mut posted = vec![forwarded];
        if !comment.is_empty() {
            let mentions = self.canonical_mentions(target, comment, None)?;
            let message = json!({"id":id(),"channel":target,"user":uid,"text":comment,"sticker":"","time":now(),"mentions":mentions});
            self.enqueue_bots(&message)?;
            posted.push(message);
        }
        self.db["messages"]
            .as_array_mut()
            .unwrap()
            .extend(posted.iter().cloned());
        self.save()?;
        self.clear_human_typing(uid, target);
        Ok(
            json!({"messages":posted.iter().map(|message| self.receipt_message(message, uid)).collect::<Vec<_>>()}),
        )
    }
}
