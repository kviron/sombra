const prefix = 'Приглашение в голосовой канал\n[sombra-voice:';
const routePattern = /^([a-zA-Z0-9_-]{1,64})\/([a-zA-Z0-9_-]{1,64})\]$/;

export function readVoiceInvitation(text: string) {
 if (!text.startsWith(prefix)) return null;
 const path = text.slice(prefix.length);
 const match = routePattern.exec(path);
 if (!match || match[0] !== path) return null;
 return {group: match[1], channel: match[2]};
}

export function voiceInvitationText(group: string, channel: string) {
 const text = `${prefix}${group}/${channel}]`;
 if (!readVoiceInvitation(text)) throw new Error('Некорректный адрес голосового канала.');
 return text;
}
