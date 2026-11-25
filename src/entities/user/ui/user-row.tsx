import {TooltipLabel} from '@/shared/ui/tooltip';
import type {ReactNode} from 'react';
import {cn} from '@/shared/lib/utils';
import {UserAvatar, type UserAvatarSize, type UserIdentity} from '@/shared/ui/user-avatar';
import {UserContextMenu} from './user-menu';
import type {UserMenuAction} from './user-menu';
import './user.css';

export type UserRowVariant = 'member' | 'voice' | 'dialog';

/** Строка одна на все списки: вариант задаёт только плотность и цвет через data-variant. */
const rowClass = cn(
 'user-row',
 'group flex w-full min-w-0 items-center gap-2.5 rounded-[8px] text-left text-muted-foreground',
 'data-[variant=member]:min-h-10 data-[variant=member]:cursor-pointer data-[variant=member]:px-2 data-[variant=member]:py-1',
 'data-[variant=dialog]:min-h-16 data-[variant=dialog]:gap-2.5 data-[variant=dialog]:px-2 data-[variant=dialog]:py-2.5',
 'data-[variant=voice]:min-h-[34px] data-[variant=voice]:gap-2 data-[variant=voice]:px-1.5 data-[variant=voice]:py-1',
 'data-[variant=voice]:text-[13px] data-[variant=voice]:text-muted-foreground data-[variant=voice]:[&>svg]:shrink-0',
 '[&[role=button]]:focus-visible:bg-[#ffffff0a] [&[role=button]]:focus-visible:outline-2',
 '[&[role=button]]:focus-visible:-outline-offset-2 [&[role=button]]:focus-visible:outline-ring'
);

export function UserRow({
 as = 'div',
 variant = 'member',
 identity,
 subtitle,
 meta,
 trailing,
 adornment,
 before,
 title,
 className,
 selected = false,
 onClick,
 menu = true,
 presence = true,
 controls,
 actions
}: {
 as?: 'li' | 'button' | 'div';
 variant?: UserRowVariant;
 identity: UserIdentity;
 subtitle?: ReactNode;
 meta?: ReactNode;
 trailing?: ReactNode;
 adornment?: ReactNode;
 before?: ReactNode;
 title?: string;
 className?: string;
 selected?: boolean;
 onClick?: () => void;
 menu?: boolean;
 presence?: boolean;
 controls?: ReactNode;
 actions?: UserMenuAction[];
}) {
 const avatarSize: UserAvatarSize = variant === 'voice' ? 'sm' : variant === 'dialog' ? 'lg' : 'md';
 const content = (
  <>
   {before}
   <UserAvatar user={identity} size={avatarSize} presence={presence} decoration={identity.decorations?.avatar} />
   {adornment}
   <span className="user-row-main flex min-w-0 flex-1 flex-col gap-0.5 group-data-[variant=voice]:gap-0">
    <span className="user-row-title flex min-w-0 items-center gap-2">
     <strong className="text-foreground truncate text-[14px] font-semibold">{identity.name}</strong>
     {identity.bot && (
      <small className="user-bot-badge bg-card text-primary inline-flex min-h-[18px] shrink-0 items-center rounded-[4px] px-[5px] py-px text-[10px] leading-[1.4] font-bold tracking-[0.03em]">
       БОТ
      </small>
     )}
     {meta}
    </span>
    {subtitle ? (
     <span className="user-row-subtitle text-muted-foreground truncate text-[12px] leading-[16px] group-data-[variant=dialog]:mt-0.5">
      {subtitle}
     </span>
    ) : null}
   </span>
   {trailing}
  </>
 );
 const rowClassNames = cn(rowClass, className);
 const offline = identity.online === false ? 'true' : undefined;
 const row =
  as === 'button' ? (
   <TooltipLabel content={title}>
    <button
     type="button"
     className={rowClassNames}
     data-variant={variant}
     data-offline={offline}
     data-selected={selected || undefined}
     aria-pressed={selected || undefined}
     onClick={onClick}
    >
     {content}
    </button>
   </TooltipLabel>
  ) : as === 'li' ? (
   <TooltipLabel content={title}>
    <li
     className={rowClassNames}
     data-variant={variant}
     data-offline={offline}
     data-selected={selected || undefined}
     role={onClick ? 'button' : undefined}
     onClick={onClick}
     tabIndex={onClick ? 0 : undefined}
     onKeyDown={
      onClick
       ? event => {
          if (event.key === 'Enter' || event.key === ' ') {
           event.preventDefault();
           onClick();
          }
         }
       : undefined
     }
    >
     {content}
    </li>
   </TooltipLabel>
  ) : (
   <TooltipLabel content={title}>
    <div
     className={rowClassNames}
     data-variant={variant}
     data-offline={offline}
     data-selected={selected || undefined}
     role={onClick ? 'button' : undefined}
     tabIndex={onClick ? 0 : undefined}
     onClick={onClick}
     onKeyDown={
      onClick
       ? event => {
          if (event.key === 'Enter' || event.key === ' ') {
           event.preventDefault();
           onClick();
          }
         }
       : undefined
     }
    >
     {content}
    </div>
   </TooltipLabel>
  );
 if (!menu) return row;
 return (
  <UserContextMenu user={identity} controls={controls} actions={actions}>
   {row}
  </UserContextMenu>
 );
}
