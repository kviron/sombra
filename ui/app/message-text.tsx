import {memo,type MouseEvent} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {toast} from 'sonner';
import {isTauri,openExternal} from '@/shared/api';
import {normalizeLinkUrl} from '@/shared/lib/message-links';
import {remarkSombraLinks,normalizeMarkdownLinkUrl} from './message-markdown-links';
import './message-text.css';

/** Browsers retain ordinary anchor behavior; native webviews use the installed opener. */
export function handleMessageLinkClick(event:MouseEvent<HTMLAnchorElement>) {
 if(!isTauri())return;
 event.preventDefault();
 const href=normalizeLinkUrl(event.currentTarget.href);
 if(href)void openExternal(href).catch(()=>toast.error('Не удалось открыть ссылку'));
}

const plugins=[remarkGfm,remarkSombraLinks];
export const MessageText=memo(function MessageText({text}:{text:string}) {
 return <div className="message-text"><Markdown remarkPlugins={plugins} skipHtml urlTransform={value=>normalizeMarkdownLinkUrl(value)||''} components={{
  a:({href,children})=>{
   const safe=href?normalizeLinkUrl(href):null;
   return safe?<a href={safe} target="_blank" rel="noopener noreferrer" title={safe} onClick={handleMessageLinkClick} onAuxClick={handleMessageLinkClick}>{children}</a>:<>{children}</>;
  },
  // Markdown never downloads images, including tracking pixels. Real chat
  // attachments remain exclusively in the authenticated attachment component.
  img:({alt})=><span className="message-markdown-image">{alt?`[Изображение: ${alt}]`:'[Изображение скрыто]'}</span>,
  input:({checked})=><input type="checkbox" checked={!!checked} disabled readOnly aria-label={checked?'Выполнено':'Не выполнено'}/>,
  table:({children})=><div className="message-table-scroll" tabIndex={0} role="region" aria-label="Таблица сообщения"><table>{children}</table></div>,
 }}>{text}</Markdown></div>;
});
