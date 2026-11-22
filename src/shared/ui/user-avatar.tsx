import type { CSSProperties } from 'react';
import { cn } from '@/shared/lib/utils';
import { ProfileEffectImage } from './profile-effect-image';
import type { ProfileEffectAsset } from '@/shared/types';
import { AvatarFrame } from '@/shared/ui/avatar-fx';
import type { AvatarDecoration, DecorationInput } from '@/shared/ui/avatar-fx';

export type UserIdentity = {
  id: string;
  name: string;
  avatar?: string;
  online?: boolean;
  bot?: boolean;
  profileEffectAssets?: {avatar?: ProfileEffectAsset};
  /** Server-provided decorations (v1 documents); absent on an older server or an undecorated account. */
  decorations?: {
    avatar?: DecorationInput | AvatarDecoration | null;
    cover?: DecorationInput | AvatarDecoration | null;
  };
};

export type UserAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Stable hue per account so the same person keeps the same initials colour. */
function avatarHue(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  return hash;
}

export function UserAvatar({
  user,
  size = 'md',
  presence = true,
  className,
  decorative = false,
  decoration,
  effectAsset=user.profileEffectAssets?.avatar,
}: {
  user: UserIdentity;
  size?: UserAvatarSize;
  effectAsset?: ProfileEffectAsset|null;
  presence?: boolean;
  className?: string;
  decorative?: boolean;
  /** Optional pixel-art decoration (v1 document). Absent/`null` keeps the plain avatar. */
  decoration?: DecorationInput | AvatarDecoration | null;
}) {
  const name = user.name?.trim() || 'Участник';
  const initial = name.slice(0, 1).toLocaleUpperCase('ru');
  return (
    <span
      className={cn('user-avatar', className)}
      data-size={size}
      data-presence={presence || undefined}
      style={{ '--avatar-hue': avatarHue(user.id || name) } as CSSProperties}
      aria-hidden={decorative || undefined}
    >
      {user.avatar ? (
        <img src={user.avatar} alt={decorative ? '' : name} />
      ) : (
        <span className="user-avatar-initial" aria-hidden="true">{initial}</span>
      )}
      {effectAsset&&<ProfileEffectImage asset={effectAsset} className="profile-avatar-effect"/>}
      {decoration ? <AvatarFrame decoration={decoration} target="avatar" size={size} /> : null}
      {presence && (
        <span
          className="user-presence"
          data-online={user.online ? 'true' : 'false'}
          role="img"
          aria-label={user.online ? 'В сети' : 'Не в сети'}
          title={user.online ? 'В сети' : 'Не в сети'}
        />
      )}
    </span>
  );
}
