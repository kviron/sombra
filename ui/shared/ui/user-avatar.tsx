import type { CSSProperties } from 'react';
import { cn } from '@/shared/lib/utils';

export type UserIdentity = {
  id: string;
  name: string;
  avatar?: string;
  online?: boolean;
  bot?: boolean;
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
}: {
  user: UserIdentity;
  size?: UserAvatarSize;
  presence?: boolean;
  className?: string;
  decorative?: boolean;
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
