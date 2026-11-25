import type {ChatState} from '@/shared/types';

export type StickerCacheSnapshot = Pick<ChatState, 'me' | 'groups' | 'stickers' | 'features'>;

/** The server includes historical stickers in this snapshot too. Only library assets may hit disk. */
export function stickerLibraryIds({me, groups, stickers}: StickerCacheSnapshot) {
 const memberships = new Set(groups.filter(group => group.members.includes(me.id)).map(group => group.id));
 return new Set(
  stickers
   .filter(
    sticker =>
     !sticker.archived &&
     (sticker.group ? memberships.has(sticker.group) : sticker.owner === me.id || sticker.packInstalled === true)
   )
   .map(sticker => sticker.id)
 );
}
