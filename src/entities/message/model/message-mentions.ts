import type {Root, RootContent, Text} from 'mdast';

/** Server-authored immutable identities; offsets are UTF-16 in the stored text. */
export type VerifiedMention = {userId: string; start: number; end: number};
export function remarkVerifiedMentions(mentions: readonly VerifiedMention[] = []) {
 return (tree: Root, file: {value: unknown}) => {
  const source = String(file.value);
  const ranges = mentions
   .filter(
    m =>
     typeof m.userId === 'string' &&
     !!m.userId &&
     Number.isInteger(m.start) &&
     Number.isInteger(m.end) &&
     m.start >= 0 &&
     m.end > m.start &&
     m.end <= source.length &&
     source[m.start] === '@'
   )
   .sort((a, b) => a.start - b.start);
  function visit(parent: {children: RootContent[]}) {
   parent.children = parent.children.flatMap(node => {
    if (['link', 'linkReference', 'image', 'imageReference', 'html', 'code', 'inlineCode'].includes(node.type))
     return [node];
    if (node.type !== 'text') {
     if ('children' in node) visit(node as {children: RootContent[]});
     return [node];
    }
    const start = node.position?.start.offset,
     end = node.position?.end.offset;
    // Markdown escapes/entities change raw offsets; never guess transformed text.
    if (start === undefined || end === undefined || source.slice(start, end) !== node.value) return [node];
    const parts: RootContent[] = [];
    let cursor = start;
    for (const mention of ranges) {
     if (mention.start < cursor || mention.end > end) continue;
     if (source[mention.start - 1] === '\\') continue;
     if (mention.start > cursor) parts.push({type: 'text', value: source.slice(cursor, mention.start)} as Text);
     parts.push({
      type: 'sombraMention',
      data: {hName: 'button', hProperties: {type: 'button', 'data-mention-user': mention.userId}},
      children: [{type: 'text', value: source.slice(mention.start, mention.end)}]
     } as unknown as RootContent);
     cursor = mention.end;
    }
    if (cursor === start) return [node];
    if (cursor < end) parts.push({type: 'text', value: source.slice(cursor, end)} as Text);
    return parts;
   });
  }
  visit(tree);
 };
}
