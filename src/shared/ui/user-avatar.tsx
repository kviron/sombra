import {TooltipLabel} from '@/shared/ui/tooltip';
import type {CSSProperties} from 'react';
import {cn} from '@/shared/lib/utils';
import {ProfileEffectImage} from './profile-effect-image';
import type {ProfileEffectAsset} from '@/shared/types';
import {AvatarFrame} from '@/shared/ui/avatar-fx';
import type {AvatarDecoration, DecorationInput} from '@/shared/ui/avatar-fx';

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

/**
 * Один аватар для всех списков. Размер задаётся переменной --avatar-size: утилиты
 * data-[size=*] на том же элементе, поэтому точка присутствия читает её же.
 */
const avatarClass = cn(
 'user-avatar',
 'group relative inline-grid shrink-0 place-items-center rounded-[50%] text-foreground',
 'size-[var(--avatar-size)] [--avatar-size:32px] text-[length:calc(var(--avatar-size)*0.4)]',
 'leading-none font-semibold tracking-[0.01em] [box-shadow:inset_0_0_0_1px_#ffffff1a] select-none',
 'bg-muted',
 'data-[size=xs]:[--avatar-size:20px] data-[size=sm]:[--avatar-size:24px] data-[size=md]:[--avatar-size:32px]',
 'data-[size=lg]:[--avatar-size:40px] data-[size=xl]:[--avatar-size:88px]'
);

/** Точка присутствия: размер и отступ по краю зависят от размера аватара (group-data). */
const presenceClass = cn(
 'user-presence',
 'absolute -right-px -bottom-px box-content size-[10px] rounded-[50%] border-2',
 'border-border bg-muted [transition:background-color_180ms_ease,box-shadow_180ms_ease]',
 'data-[online=true]:bg-emerald-500 data-[online=true]:[box-shadow:0_0_9px_#3ecf8e66]',
 'group-data-[size=xs]:size-[7px] group-data-[size=sm]:size-[8px]',
 'group-data-[size=xl]:right-[4px] group-data-[size=xl]:bottom-[4px] group-data-[size=xl]:size-[13px]',
 'group-data-[size=xl]:border-[3px]'
);

export function UserAvatar({
 user,
 size = 'md',
 presence = true,
 className,
 decorative = false,
 decoration,
 effectAsset = user.profileEffectAssets?.avatar
}: {
 user: UserIdentity;
 size?: UserAvatarSize;
 effectAsset?: ProfileEffectAsset | null;
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
   className={cn(avatarClass, className)}
   data-size={size}
   data-presence={presence || undefined}
   style={{'--avatar-hue': avatarHue(user.id || name)} as CSSProperties}
   aria-hidden={decorative || undefined}
  >
   {user.avatar ? (
    <img
     className="block h-full w-full rounded-[inherit] object-cover"
     src={user.avatar}
     alt={decorative ? '' : name}
    />
   ) : (
    <span className="user-avatar-initial" aria-hidden="true">
     {initial}
    </span>
   )}
   {effectAsset && (
    <ProfileEffectImage
     asset={effectAsset}
     className="profile-avatar-effect pointer-events-none absolute inset-0 h-full w-full rounded-[inherit] object-cover"
    />
   )}
   {decoration ? <AvatarFrame decoration={decoration} target="avatar" size={size} /> : null}
   {presence && (
    <TooltipLabel content={user.online ? 'В сети' : 'Не в сети'}>
     <span
      className={presenceClass}
      data-online={user.online ? 'true' : 'false'}
      role="img"
      aria-label={user.online ? 'В сети' : 'Не в сети'}
     />
    </TooltipLabel>
   )}
  </span>
 );
}
