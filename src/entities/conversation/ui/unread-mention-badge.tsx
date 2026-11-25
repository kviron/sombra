import {TooltipLabel} from '@/shared/ui/tooltip';
import '@/entities/message/ui/message-mentions.css';
export function UnreadMentionBadge({count}: {count?: number}) {
 if (!Number.isFinite(count) || !count || count < 1) return null;
 const label = `Есть непрочитанные упоминания: ${count}`;
 return (
  <TooltipLabel content={label}>
   <span className="unread-mention-badge" aria-label={label}>
    @{count > 1 ? (count > 99 ? '99+' : count) : ''}
   </span>
  </TooltipLabel>
 );
}
