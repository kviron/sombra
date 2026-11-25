import {memo, useMemo, type MouseEvent} from 'react';
import {useUserActions} from '@/shared/lib/user-actions';
import {remarkVerifiedMentions, type VerifiedMention} from '../model/message-mentions';
import './message-mentions.css';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Checkbox} from '@/shared/ui/checkbox';
import {toast} from 'sonner';
import {isTauri, openExternal} from '@/shared/api';
import {normalizeLinkUrl} from '@/shared/lib/message-links';
import {cn} from '@/shared/lib';
import {remarkSombraLinks, normalizeMarkdownLinkUrl} from '../model/message-markdown-links';
import './message-text.css';

/** Browsers retain ordinary anchor behavior; native webviews use the installed opener. */
export function handleMessageLinkClick(event: MouseEvent<HTMLAnchorElement>) {
 if (!isTauri()) return;
 event.preventDefault();
 const href = normalizeLinkUrl(event.currentTarget.href);
 if (href) void openExternal(href).catch(() => toast.error('Не удалось открыть ссылку'));
}

/** Polls replace the state arrays every few seconds; equal spans must not re-parse Markdown. */
function sameMentions(previous?: readonly VerifiedMention[], next?: readonly VerifiedMention[]) {
 if (previous === next) return true;
 if (!previous || !next || previous.length !== next.length) return false;
 return previous.every(
  (mention, index) =>
   mention.userId === next[index].userId && mention.start === next[index].start && mention.end === next[index].end
 );
}

export const MessageText = memo(
 function MessageText({text, mentions}: {text: string; mentions?: readonly VerifiedMention[]}) {
  const actions = useUserActions();
  const plugins = useMemo(
   () => [remarkGfm, [remarkVerifiedMentions, mentions || []], remarkSombraLinks] as import('unified').PluggableList,
   [mentions]
  );
  return (
   <div className={cn('message-text', 'max-w-full min-w-0 leading-[1.6] [overflow-wrap:anywhere] whitespace-normal')}>
    <Markdown
     remarkPlugins={plugins}
     skipHtml
     urlTransform={value => normalizeMarkdownLinkUrl(value) || ''}
     components={{
      button: ({node, children}) => {
       const id = node?.properties?.['data-mention-user'];
       return typeof id === 'string' ? (
        <button
         type="button"
         className="message-mention"
         title="Открыть профиль"
         aria-label={`Открыть профиль ${String(children)}`}
         onClick={() => actions?.openProfile(id)}
        >
         {children}
        </button>
       ) : (
        <>{children}</>
       );
      },
      a: ({href, children}) => {
       const safe = href ? normalizeLinkUrl(href) : null;
       return safe ? (
        <a
         href={safe}
         target="_blank"
         rel="noopener noreferrer"
         title={safe}
         onClick={handleMessageLinkClick}
         onAuxClick={handleMessageLinkClick}
        >
         {children}
        </a>
       ) : (
        <>{children}</>
       );
      },
      // Markdown never downloads images, including tracking pixels. Real chat
      // attachments remain exclusively in the authenticated attachment component.
      img: ({alt}) => (
       <span
        className={cn(
         'message-markdown-image',
         'text-muted-foreground text-[0.95em] [overflow-wrap:anywhere] whitespace-normal'
        )}
       >
        {alt ? `[Изображение: ${alt}]` : '[Изображение скрыто]'}
       </span>
      ),
      input: ({checked}) => (
       <Checkbox checked={!!checked} disabled aria-label={checked ? 'Выполнено' : 'Не выполнено'} />
      ),
      table: ({children}) => (
       <div
        className={cn(
         'message-table-scroll',
         'border-border my-[0.65em] block max-w-full overflow-x-auto rounded-md border',
         'focus-visible:rounded-[2px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[currentColor]'
        )}
        tabIndex={0}
        role="region"
        aria-label="Таблица сообщения"
       >
        <table>{children}</table>
       </div>
      )
     }}
    >
     {text}
    </Markdown>
   </div>
  );
 },
 (previous, next) => previous.text === next.text && sameMentions(previous.mentions, next.mentions)
);
