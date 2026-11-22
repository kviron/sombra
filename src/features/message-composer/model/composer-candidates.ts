import type {ChatState} from '@/shared/types';

/** Only the caret's queried fragment is replaced; emails never activate mentions. */
export function composerTrigger(text: string, char: string, caret: number) {
 const before = text.slice(0, caret);
 const match = char === '@' ? /(?:^|[\s([{])@([^\s@]*)$/u.exec(before) : /^\/([\w@-]*)$/u.exec(before);
 if (!match) return null;
 return {query: match[1], offset: caret - match[1].length - 1, endOffset: caret};
}
export function scopedBots(state: ChatState, channel: string, group?: string) {
 const dialog = state.dialogs.find(d => d.id === channel);
 const directBot =
  !group && dialog?.members.length === 2
   ? dialog.members.find(id => id !== state.me.id && state.users.some(u => u.id === id && u.bot))
   : undefined;
 return state.bots.filter(
  b =>
   b.enabled !== false &&
   (directBot
    ? b.id === directBot
    : group
      ? b.groups
        ? b.groups.includes(group) || b.channel === channel
        : b.group === group || b.channel === channel
      : !!dialog?.members.includes(b.id))
 );
}
export function mentionCandidates(state: ChatState, channel: string, group?: string) {
 const ids = new Set(
  group ? state.groups.find(g => g.id === group)?.members : state.dialogs.find(d => d.id === channel)?.members
 );
 const bots = scopedBots(state, channel, group);
 if (group) for (const bot of bots) ids.add(bot.id);
 const enabledBots = new Set(bots.map(b => b.id));
 return [...ids]
  .filter(id => id !== state.me.id)
  .flatMap(id => {
   const user = state.users.find(u => u.id === id),
    bot = bots.find(b => b.id === id);
   if ((!user && !bot) || (user?.bot && !enabledBots.has(id))) return [];
   const name = user?.name || bot!.name,
    username = user?.username || bot?.username,
    isBot = !!(user?.bot || bot);
   return [
    {
     id,
     type: 'mention',
     label: name,
     description: `${isBot ? 'Бот' : 'Участник'} · @${username || name}${username ? '' : ` · ${id.slice(0, 8)}`}`,
     metadata: {insert: `@${username || name}`, avatar: user?.avatar || '', search: `${name} ${username || ''}`}
    }
   ];
  });
}
export const localCommandCandidates = [
 {
  id: 'local:search',
  type: 'local-command',
  label: '/search',
  description: 'Поиск в переписке · открыть поле поиска',
  metadata: {insert: '', avatar: '', search: 'search'}
 },
 {
  id: 'local:clear',
  type: 'local-command',
  label: '/clear',
  description: 'Очистить черновик · только текст, не историю и не вложение',
  metadata: {insert: '', avatar: '', search: 'clear'}
 }
];
export function commandCandidates(state: ChatState, channel: string, group?: string) {
 const dialog = state.dialogs.find(d => d.id === channel);
 const directBot =
  !group &&
  dialog?.members.length === 2 &&
  dialog.members.some(id => id !== state.me.id && state.users.some(u => u.id === id && u.bot));
 return scopedBots(state, channel, group).flatMap(bot =>
  (bot.commands || []).map(command => {
   const value = `/${command.command.replace(/^\//, '')}${!directBot && bot.username ? '@' + bot.username : ''}`;
   return {
    id: `${bot.id}:${command.command}`,
    type: 'command',
    label: value,
    description: `${command.description} · ${bot.name}`,
    metadata: {insert: value, avatar: '', search: value.slice(1)}
   };
  })
 );
}
