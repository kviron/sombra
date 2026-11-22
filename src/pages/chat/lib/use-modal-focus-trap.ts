import {useEffect, useRef} from 'react';

type Options = {
 /** Открыто ли окно, которое удерживает фокус. */
 active: boolean;
 /** Пока действие выполняется, Escape не закрывает окно. */
 busy: boolean;
 onEscape: () => void;
};

/**
 * Фокус в открытом окне: первое поле получает фокус, Tab ходит по кругу,
 * Escape закрывает окно, а после закрытия фокус возвращается туда, откуда пришёл.
 */
export function useModalFocusTrap({active, busy, onEscape}: Options) {
 const escape = useRef(onEscape);
 escape.current = onEscape;
 useEffect(() => {
  if (!active) return;
  const previous = document.activeElement as HTMLElement | null;
  const dialog = document.querySelector<HTMLElement>('[role=dialog]');
  dialog?.querySelector<HTMLElement>('input,button')?.focus();
  const handle = (event: KeyboardEvent) => {
   if (
    event.defaultPrevented ||
    document.querySelector('[data-image-crop-dialog],.sticker-collection-modal,.sticker-preview-dialog')
   )
    return;
   if (event.key === 'Escape' && !busy) escape.current();
   if (event.key === 'Tab' && dialog) {
    const items = Array.from(
     dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,a[href]')
    );
    const visible = items.filter(item => item.getClientRects().length > 0);
    const first = visible[0],
     last = visible.at(-1);
    if (event.shiftKey && document.activeElement === first) {
     event.preventDefault();
     last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
     event.preventDefault();
     first?.focus();
    }
   }
  };
  window.addEventListener('keydown', handle);
  return () => {
   window.removeEventListener('keydown', handle);
   previous?.focus();
  };
 }, [active, busy]);
}
