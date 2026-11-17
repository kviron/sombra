import type {MouseEvent} from 'react';
import {toast} from 'sonner';
import {isTauri,openExternal} from '@/shared/api';
import {normalizeLinkUrl,parseMessageLinks} from '@/shared/lib/message-links';
import './message-text.css';

/** Browsers retain ordinary anchor behavior; native webviews use the installed opener. */
export function handleMessageLinkClick(event:MouseEvent<HTMLAnchorElement>) {
 if(!isTauri())return;
 event.preventDefault();
 const href=normalizeLinkUrl(event.currentTarget.href);
 if(href)void openExternal(href).catch(()=>toast.error('Не удалось открыть ссылку'));
}

export function MessageText({text}:{text:string}) {
 return <p className="message-text">{parseMessageLinks(text).map((part,index)=>part.type==='text'
  ?part.text
  :<a key={index} href={part.href} target="_blank" rel="noopener noreferrer" title={part.href} onClick={handleMessageLinkClick} onAuxClick={handleMessageLinkClick}>{part.text}</a>
 )}</p>;
}
