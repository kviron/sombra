import {Button} from '@/shared/ui/button';
import {Input} from '@/shared/ui/input';
import {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, ArrowUpRight, ChevronRight, File, Headphones, Image, Link2, Search, Video, X} from 'lucide-react';
import type {ChatMessage} from '@/shared/types';
import {
 conversationMaterials,
 filterMaterials,
 type MaterialCategory,
 type ConversationMaterial
} from '@/entities/message';
import {MessageAttachment} from '@/entities/message';
import {handleMessageLinkClick} from '@/entities/message';
import {cn} from '@/shared/lib';
import './conversation-materials.css';
const categories = [
 {id: 'photos', label: 'Фото', icon: Image},
 {id: 'videos', label: 'Видео', icon: Video},
 {id: 'files', label: 'Файлы', icon: File},
 {id: 'audio', label: 'Аудио', icon: Headphones},
 {id: 'links', label: 'Ссылки', icon: Link2}
] as const;
const month = (time: number) => new Date(time * 1000).toLocaleDateString('ru', {month: 'long', year: 'numeric'});
const date = (time: number) => new Date(time * 1000).toLocaleDateString('ru', {day: 'numeric', month: 'short'});
export function ConversationMaterials({
 channel,
 title,
 messages,
 userName,
 onClose,
 onJump,
 initialCategory = 'all'
}: {
 channel: string;
 title: string;
 messages: ChatMessage[];
 userName: (id: string) => string;
 onClose: () => void;
 onJump: (id: string) => void;
 initialCategory?: MaterialCategory | 'all';
}) {
 const [category, setCategory] = useState<MaterialCategory | 'all'>(initialCategory),
  [query, setQuery] = useState('');
 const [limit, setLimit] = useState(60);
 const panel = useRef<HTMLElement>(null);
 useEffect(() => {
  const element = panel.current,
   body = element?.parentElement,
   composer = body?.querySelector<HTMLElement>('.composer-chrome, .composer');
  if (!element || !body || !composer) return;
  const measure = () =>
   element.style.setProperty(
    '--materials-composer-inset',
    `${Math.max(0, body.getBoundingClientRect().bottom - composer.getBoundingClientRect().top + 8)}px`
   );
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(body);
  observer.observe(composer);
  return () => observer.disconnect();
 }, []);
 const items = useMemo(() => conversationMaterials(messages, channel), [messages, channel]);
 const filtered = filterMaterials(items, category, query, userName);
 const counts = Object.fromEntries(
  categories.map(item => [item.id, items.filter(material => material.category === item.id).length])
 );
 const grouped = new Map<string, ConversationMaterial[]>();
 for (const item of filtered.slice(0, limit)) {
  const key = month(item.message.time);
  const group = grouped.get(key);
  if (group) group.push(item);
  else grouped.set(key, [item]);
 }
 const overview = category === 'all' && !query.trim();
 const label = categories.find(item => item.id === category)?.label || 'Материалы чата';
 useEffect(() => {
  function escape(event: KeyboardEvent) {
   if (
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !document.querySelector('[role="dialog"][aria-modal="true"]')
   )
    onClose();
  }
  window.addEventListener('keydown', escape);
  return () => window.removeEventListener('keydown', escape);
 }, [onClose]);
 function jump(item: ConversationMaterial) {
  onJump(item.message.id);
 }
 return (
  <aside ref={panel} id="conversation-materials" className="conversation-materials" aria-label="Материалы переписки">
   <header className="materials-heading">
    {category !== 'all' && (
     <button
      type="button"
      aria-label="Все материалы"
      onClick={() => {
       setCategory('all');
       setLimit(60);
      }}
     >
      <ArrowLeft size={18} />
     </button>
    )}
    <div>
     <h2>{label}</h2>
     <p title={title}>{title}</p>
    </div>
    <button type="button" aria-label="Закрыть материалы" title="Закрыть панель" onClick={onClose}>
     <X size={18} />
    </button>
   </header>
   <div className="relative mx-3 mb-3 shrink-0">
    <Search
     aria-hidden="true"
     className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
    />
    <Input
     aria-label="Поиск материалов переписки"
     placeholder="Название, ссылка или автор"
     value={query}
     onChange={event => {
      setQuery(event.target.value);
      setLimit(60);
     }}
    />
    {query && (
     <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="absolute top-1/2 right-1 -translate-y-1/2"
      aria-label="Очистить поиск материалов"
      onClick={() => setQuery('')}
     >
      <X />
     </Button>
    )}
   </div>
   <div className="materials-content min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-5">
    {overview ? (
     <>
      <nav className="materials-categories" aria-label="Категории материалов">
       {categories.map(({id, label, icon: Icon}) => (
        <button
         key={id}
         type="button"
         onClick={() => {
          setCategory(id);
          setLimit(60);
         }}
        >
         <Icon size={20} />
         <span>{label}</span>
         <small>{counts[id]}</small>
         <ChevronRight size={16} />
        </button>
       ))}
      </nav>
      <div className="materials-summary text-muted-foreground px-3 py-7 text-center [&>svg]:mx-auto [&>svg]:mb-3 [&>svg]:opacity-80">
       <Link2 size={24} />
       <p className="m-0 mb-2 text-[13px] leading-[1.5]">Вложения и ссылки этой переписки — в одном месте.</p>
       <span className="block text-xs leading-[1.5]">
        {items.length
         ? 'Выберите категорию или воспользуйтесь поиском.'
         : 'Пока здесь нет материалов. Они появятся после отправки вложения или ссылки.'}
       </span>
      </div>
     </>
    ) : (
     <>
      <p className="materials-results text-muted-foreground mx-0 mt-1 mb-3 text-xs leading-[1.5]" role="status">
       {filtered.length ? `Найдено: ${filtered.length}` : query ? 'Ничего не найдено' : 'В этой категории пока пусто'}
      </p>
      {[...grouped].map(([monthLabel, entries]) => (
       <section className="materials-month-group" key={monthLabel}>
        <h3 className="materials-month text-muted-foreground mt-4 mb-2 text-xs leading-[1.5] font-semibold capitalize">
         {monthLabel}
        </h3>
        <div className={category === 'photos' ? 'materials-photo-grid' : 'materials-list grid gap-2'}>
         {entries.map(item => (
          <article
           key={item.id}
           className={cn(
            'material-card',
            'border-border relative min-w-0 overflow-hidden rounded-[9px] border',
            'data-[category=photos]:border-transparent data-[category=photos]:bg-transparent'
           )}
           data-material-id={item.id}
           data-category={item.category}
           data-expired={(item.message.attachment?.expired && !item.message.attachment.cached) || undefined}
          >
           {item.href ? (
            <div className="material-link flex min-w-0 items-start gap-2.5 px-3 pt-3 pb-1">
             <div className="material-link-symbol text-primary grid size-9 shrink-0 place-items-center rounded-[8px]">
              <Link2 size={19} />
             </div>
             <div className="min-w-0 flex-1">
              <a
               className="text-primary line-clamp-2 block text-[13px] leading-[1.45] font-semibold [overflow-wrap:anywhere] hover:underline"
               href={item.href}
               target="_blank"
               rel="noopener noreferrer"
               onClick={handleMessageLinkClick}
               onAuxClick={handleMessageLinkClick}
              >
               {item.title}
              </a>
              <span className="text-muted-foreground mt-1 block text-[11px] [overflow-wrap:anywhere]">
               {new URL(item.href).hostname}
              </span>
              <p className="text-primary mt-[5px] mb-0 overflow-hidden text-xs leading-[1.4] text-ellipsis whitespace-nowrap">
               {item.href}
              </p>
             </div>
            </div>
           ) : (
            item.message.attachment && (
             <>
              <MessageAttachment messageId={item.message.id} attachment={item.message.attachment} />
             </>
            )
           )}
           <footer className="material-caption text-muted-foreground flex min-w-0 items-center gap-2 px-2 pt-1 pb-1 pl-3 text-[11px]">
            <span
             className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
             title={userName(item.message.user)}
            >
             {userName(item.message.user)} · {date(item.message.time)}
            </span>
            <button
             type="button"
             title="Перейти к сообщению"
             aria-label={`Перейти к сообщению: ${item.title}`}
             onClick={() => jump(item)}
            >
             <ArrowUpRight size={17} />
            </button>
           </footer>
          </article>
         ))}
        </div>
       </section>
      ))}
      {filtered.length > limit && (
       <button type="button" className="materials-load-more" onClick={() => setLimit(value => value + 60)}>
        Показать ещё · {filtered.length - limit}
       </button>
      )}
     </>
    )}
   </div>
  </aside>
 );
}
