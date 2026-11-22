// Хранилище зоны перетаскивания: подсказка о сбросе и счётчик входов.
// Модель создаётся на зону: у страницы чата она одна на переписку.
import {createStore} from 'zustand/vanilla';
import {toast} from 'sonner';
import type {DragEvent} from 'react';
import {dropEffectFor, dropError, hasDraggedFiles, isFileItem} from './attachment-drop-zone-rules';

export type AttachmentDropState = {dragging: boolean};

export type DropArgs = {accepting: boolean; onFile: (file: File) => void};

export function createAttachmentDropModel() {
 const store = createStore<AttachmentDropState>(() => ({dragging: false}));
 /** Вложенные сообщения дают по событию на каждый слой: считаем входы, а не флаг. */
 let depth = 0;

 const actions = {
  reset() {
   depth = 0;
   store.setState({dragging: false});
  },

  enter(event: DragEvent<HTMLElement>, accepting: boolean) {
   if (!hasDraggedFiles(event.dataTransfer)) return;
   event.preventDefault();
   event.stopPropagation();
   if (!accepting) return;
   depth++;
   store.setState({dragging: true});
  },

  over(event: DragEvent<HTMLElement>, accepting: boolean) {
   if (!hasDraggedFiles(event.dataTransfer)) return;
   event.preventDefault();
   event.stopPropagation();
   event.dataTransfer.dropEffect = dropEffectFor(accepting);
   if (accepting) store.setState({dragging: true});
  },

  leave(event: DragEvent<HTMLElement>) {
   if (!hasDraggedFiles(event.dataTransfer)) return;
   event.preventDefault();
   event.stopPropagation();
   // Переход между вложенными сообщениями и кнопками не должен мигать подсказкой.
   depth = Math.max(0, depth - 1);
   if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
   if (!depth || (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)))
    actions.reset();
  },
  /** Сброс: один файл и не папка, иначе подсказка вместо вложения. */
  drop(event: DragEvent<HTMLElement>, {accepting, onFile}: DropArgs) {
   if (!hasDraggedFiles(event.dataTransfer)) return;
   event.preventDefault();
   event.stopPropagation();
   actions.reset();
   if (!accepting) return;
   const items = Array.from(event.dataTransfer.items || []).filter(isFileItem);
   const files = Array.from(event.dataTransfer.files || []);
   const message = dropError({
    directories: items.some(item => item.webkitGetAsEntry?.()?.isDirectory === true),
    count: files.length
   });
   if (message) {
    toast.error(message);
    return;
   }
   onFile(files[0]);
  }
 };

 return {store, actions};
}

export type AttachmentDropStore = ReturnType<typeof createAttachmentDropModel>;
