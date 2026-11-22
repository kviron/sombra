import '@/entities/message/ui/message-mentions.css';
export function UnreadMentionBadge({count}: {count?: number}) {
 if (!Number.isFinite(count) || !count || count < 1) return null;
 const label = `Есть непрочитанные упоминания: ${count}`;
 return (
  <span className="unread-mention-badge" title={label} aria-label={label}>
   @{count > 1 ? (count > 99 ? '99+' : count) : ''}
  </span>
 );
}
