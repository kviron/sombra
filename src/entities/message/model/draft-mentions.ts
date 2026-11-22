import type {VerifiedMention} from './message-mentions';
export type MentionDraft = {text: string; mentions: VerifiedMention[]};
/** One server-verifiable participant: the text the composer inserted must still be their alias. */
export type MentionAlias = {id: string; name: string; username?: string};
/** Trim exactly what the server trims (Rust White_Space), plus U+FEFF, so offsets cannot drift. */
const EDGE = /^[\s\u0085]+|[\s\u0085]+$/gu;
/** The server's own boundary rules; JS \s would wrongly accept U+FEFF before an alias.
 *  Letters, marks and numbers are a superset of Rust's is_alphanumeric, so nothing invalid is sent. */
// eslint-disable-next-line no-control-regex -- граница слова включает управляющие разделители
const BOUNDARY = /[\t\n\u000B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000([{>'",;:!?]/u,
 WORD = /[\p{L}\p{M}\p{N}_@-]/u;
export const MENTION_LIMIT = 100;
export function trimmedDraftText(text: string) {
 return text.replace(EDGE, '');
}
/** Shift ranges around a single edit; touching a token revokes its identity. */
export function editMentionDraft(previous: MentionDraft, text: string): MentionDraft {
 if (previous.text === text) return previous;
 let prefix = 0;
 while (prefix < previous.text.length && prefix < text.length && previous.text[prefix] === text[prefix]) prefix++;
 let suffix = 0;
 while (
  suffix < previous.text.length - prefix &&
  suffix < text.length - prefix &&
  previous.text[previous.text.length - 1 - suffix] === text[text.length - 1 - suffix]
 )
  suffix++;
 const oldEnd = previous.text.length - suffix,
  delta = text.length - previous.text.length;
 return {
  text,
  mentions: previous.mentions.flatMap(m =>
   m.end <= prefix ? [m] : m.start >= oldEnd ? [{...m, start: m.start + delta, end: m.end + delta}] : []
  )
 };
}
/** Draft spans expressed relative to the trimmed text the server will store. */
export function trimmedDraftMentions(draft: MentionDraft, text: string) {
 const current = editMentionDraft(draft, text),
  trimmed = trimmedDraftText(text);
 const shift = text.length - text.replace(/^[\s\u0085]+/u, '').length,
  end = shift + trimmed.length;
 return current.mentions
  .filter(m => m.start >= shift && m.end <= end)
  .map(m => ({...m, start: m.start - shift, end: m.end - shift}));
}
/** The single place a mention leaves the composer: only spans the server would accept are sent.
 *  Anything the text no longer proves (edited alias, renamed/kicked participant, broken boundary,
 *  overlap, cut or out-of-range offset) is dropped instead of risking INVALID_MENTIONS. */
export function mentionSendPayload(draft: MentionDraft, text: string, aliases: readonly MentionAlias[]) {
 const trimmed = trimmedDraftText(text),
  allowed = new Map<string, Set<string>>();
 for (const row of aliases) {
  const set = allowed.get(row.id) ?? new Set<string>();
  for (const alias of [row.name, row.username])
   if (alias && alias.trim() === alias && !/[\n\r@]/u.test(alias)) set.add('@' + alias);
  allowed.set(row.id, set);
 }
 let previousEnd = 0;
 const mentions = trimmedDraftMentions(draft, text)
  .sort((a, b) => a.start - b.start)
  .filter(m => {
   if (m.start < previousEnd || m.end <= m.start || m.end > trimmed.length || trimmed[m.start] !== '@') return false;
   if (!allowed.get(m.userId)?.has(trimmed.slice(m.start, m.end))) return false;
   if (m.start > 0 && !BOUNDARY.test(trimmed[m.start - 1])) return false;
   const after = trimmed[m.end];
   if (after !== undefined && WORD.test(after)) return false;
   previousEnd = m.end;
   return true;
  })
  .slice(0, MENTION_LIMIT)
  .map(({userId, start, end}) => ({userId, start, end}));
 return {text: trimmed, mentions};
}
