/** Ключи хранилища в одном месте: их читают транспорт, тема, звонки и всплывающие заметки. */
export const SESSION_KEY = 'mines-session';
export const JWT_KEY = 'mines-jwt';
export const THEME_KEY = 'mines-theme';
export const MEDIA_KEY = 'mines-media';
export const PARTICIPANT_VOLUME_PREFIX = 'sombra-participant-volume:';
export const PROFILE_NOTE_PREFIX = 'sombra-profile-note:';

export function participantVolumeKey(viewer: string, user: string) {
 return `${PARTICIPANT_VOLUME_PREFIX}${viewer}:${user}`;
}

export function profileNoteKey(user: string) {
 return `${PROFILE_NOTE_PREFIX}${user}`;
}
