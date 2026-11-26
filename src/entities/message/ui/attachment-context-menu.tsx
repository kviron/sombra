import {TooltipLabel} from '@/shared/ui/tooltip';
import {useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {Copy, Download} from 'lucide-react';
import {cn} from '@/shared/lib';
import type {AttachmentActionId, AttachmentActionItem} from '../model/message-attachment-rules';

const actionIcons = {copy: Copy, download: Download};
/** Отступ от края окна, чтобы пункты не прилипали к рамке. */
const windowEdge = 8;

export type AttachmentMenuPosition = {x: number; y: number} | 'trigger';

type AttachmentContextMenuProps = {
 position: AttachmentMenuPosition;
 container?: HTMLElement | null;
 items: AttachmentActionItem[];
 label: string;
 onClose: () => void;
 onSelect: (id: AttachmentActionId) => void;
 returnFocus: RefObject<HTMLElement | null>;
};

/** Пункты меню — обычные кнопки: нативные Enter и Space работают без ручной обработки. */
const menuActions = (menu: HTMLElement | null) => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

/**
 * Контекстное меню картинки: открывается по курсору, не выходит за границы окна,
 * держит фокус внутри себя и возвращает его на картинку после закрытия.
 */
export function AttachmentContextMenu({
 position,
 container,
 items,
 label,
 onClose,
 onSelect,
 returnFocus
}: AttachmentContextMenuProps) {
 const menu = useRef<HTMLDivElement>(null);
 const [coordinates, setCoordinates] = useState({left: windowEdge, top: windowEdge});

 useLayoutEffect(() => {
  const element = menu.current;
  if (!element) return;
  const place = () => {
   const anchor = returnFocus.current?.getBoundingClientRect();
   const {offsetWidth: width, offsetHeight: height} = element;
   const x = position === 'trigger' ? (anchor?.right ?? window.innerWidth) - width : position.x;
   const y = position === 'trigger' ? (anchor?.top ?? window.innerHeight) - height - 4 : position.y;
   setCoordinates({
    left: Math.max(windowEdge, Math.min(x, window.innerWidth - width - windowEdge)),
    top: Math.max(windowEdge, Math.min(y, window.innerHeight - height - windowEdge))
   });
  };
  place();
  window.addEventListener('resize', place);
  return () => window.removeEventListener('resize', place);
 }, [position, returnFocus]);

 // Фокус входит в первое доступное действие и возвращается туда, откуда меню открыли.
 useEffect(() => {
  const target = returnFocus.current;
  const actions = menuActions(menu.current);
  (actions.find(action => !action.hasAttribute('data-disabled')) ?? actions[0] ?? menu.current)?.focus();
  return () => {
   target?.focus({preventScroll: true});
  };
 }, [returnFocus]);

 useEffect(() => {
  const handle = (event: Event) => {
   const target = event.target as Node;
   if (container && returnFocus.current?.contains(target)) return;
   if (!menu.current?.contains(target)) onClose();
  };
  // Фон просмотрщика должен получить клик, пока меню ещё открыто, чтобы закрыть только меню.
  const eventType = container ? 'click' : 'pointerdown';
  document.addEventListener(eventType, handle, !container);
  return () => document.removeEventListener(eventType, handle, !container);
 }, [onClose, container, returnFocus]);

 function moveFocus(step: number) {
  const actions = menuActions(menu.current);
  if (!actions.length) {
   menu.current?.focus();
   return;
  }
  const current = actions.indexOf(document.activeElement as HTMLElement);
  const next = current < 0 ? (step > 0 ? 0 : actions.length - 1) : (current + step + actions.length) % actions.length;
  actions[next]?.focus();
 }

 function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key === 'Escape') {
   event.preventDefault();
   onClose();
   return;
  }
  // Tab не уводит фокус на страницу под меню: он ходит по тем же пунктам.
  if (event.key === 'Tab') {
   event.preventDefault();
   moveFocus(event.shiftKey ? -1 : 1);
   return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
   event.preventDefault();
   moveFocus(event.key === 'ArrowDown' ? 1 : -1);
   return;
  }
  if (event.key === 'Home' || event.key === 'End') {
   const actions = menuActions(menu.current);
   if (!actions.length) return;
   event.preventDefault();
   (event.key === 'Home' ? actions[0] : actions[actions.length - 1])?.focus();
  }
 }

 function run(item: AttachmentActionItem) {
  if (item.disabled) return;
  onClose();
  onSelect(item.id);
 }

 return createPortal(
  <div
   ref={menu}
   role="menu"
   aria-label={label}
   tabIndex={-1}
   className={cn(
    'attachment-context-menu',
    'border-border bg-popover text-popover-foreground fixed z-[160] flex max-w-[calc(100vw_-_16px)] min-w-44 flex-col gap-0.5 rounded-md border p-1',
    'shadow-[0_16px_40px_#0005,inset_0_1px_0_#ffffff10]'
   )}
   style={coordinates}
   onKeyDown={handleKeyDown}
   onContextMenu={event => {
    event.preventDefault();
    event.stopPropagation();
   }}
  >
   {items.map(item => {
    const Icon = actionIcons[item.id];
    return (
     <TooltipLabel content={item.title} key={item.id}>
      <button
       type="button"
       role="menuitem"
       tabIndex={-1}
       className={cn(
        'attachment-context-menu-item',
        'flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-[calc(var(--radius-md,10px)_-_4px)] border-0 bg-transparent px-2 text-left text-inherit',
        '[&:not([data-disabled])]:hover:bg-accent [&:not([data-disabled])]:hover:text-accent-foreground',
        '[&:not([data-disabled])]:focus-visible:bg-accent [&:not([data-disabled])]:focus-visible:text-accent-foreground',
        'data-[disabled]:cursor-default data-[disabled]:opacity-50',
        'focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-[-2px]'
       )}
       data-disabled={item.disabled ? '' : undefined}
       aria-disabled={item.disabled || undefined}
       aria-label={item.disabled ? `${item.label}. ${item.title}` : undefined}
       onClick={() => run(item)}
      >
       <Icon size={16} aria-hidden="true" />
       {item.label}
      </button>
     </TooltipLabel>
    );
   })}
  </div>,
  container ?? document.body
 );
}
