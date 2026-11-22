import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import { UserAvatar, type UserAvatarSize, type UserIdentity } from '@/shared/ui/user-avatar';
import { UserContextMenu } from './user-menu';
import type { UserMenuAction } from './user-menu';
import './user.css';

export type UserRowVariant = 'member' | 'voice' | 'dialog';

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
  actions,
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
      <span className="user-row-main">
        <span className="user-row-title">
          <strong>{identity.name}</strong>
          {identity.bot&&<small className="user-bot-badge">БОТ</small>}
          {meta}
        </span>
        {subtitle ? <span className="user-row-subtitle">{subtitle}</span> : null}
      </span>
      {trailing}
    </>
  );
  const rowClass = cn('user-row', className);
  const offline = identity.online === false ? 'true' : undefined;
  const row = as === 'button' ? (
    <button
      type="button"
      className={rowClass}
      data-variant={variant}
      data-offline={offline}
      data-selected={selected || undefined}
      title={title}
      aria-pressed={selected || undefined}
      onClick={onClick}
    >
      {content}
    </button>
  ) : as === 'li' ? (
    <li
      className={rowClass}
      data-variant={variant}
      data-offline={offline}
      data-selected={selected || undefined}
      title={title}
      role={onClick ? 'button' : undefined}
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } } : undefined}
    >
      {content}
    </li>
  ) : (
    <div
      className={rowClass}
      data-variant={variant}
      data-offline={offline}
      data-selected={selected || undefined}
      title={title}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } } : undefined}
    >
      {content}
    </div>
  );
  if (!menu) return row;
  return <UserContextMenu user={identity} controls={controls} actions={actions}>{row}</UserContextMenu>;
}
