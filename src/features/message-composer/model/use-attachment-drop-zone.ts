import {useEffect, useState} from 'react';
import {useStore} from 'zustand';
import type {DragEvent} from 'react';
import {acceptingDrops, dropOverlayVisible, hasDraggedFiles} from './attachment-drop-zone-rules';
import {createAttachmentDropModel} from './attachment-drop-zone';

type Options = {
 channel?: string;
 disabled?: boolean;
 onFiles: (files: File[]) => void;
};

/**
 * Единственное место, где живёт логика переноса: подсказка, счётчик входов и
 * защита окна от чужих файлов. Компонент получает флаг и обработчики.
 */
export function useAttachmentDropZone({channel, disabled = false, onFiles}: Options) {
 const [model] = useState(createAttachmentDropModel);
 const {dragging} = useStore(model.store);
 const {actions} = model;
 const accepting = acceptingDrops(channel, disabled);

 // Смена переписки и запрет сбрасывают подсказку: незавершённый перенос неактуален.
 useEffect(() => {
  actions.reset();
 }, [actions, channel, disabled]);

 // Файл, брошенный мимо переписки, не должен открыться в WebView вместо чата.
 useEffect(() => {
  const outsideDrag = (event: globalThis.DragEvent) => {
   if (!hasDraggedFiles(event.dataTransfer)) return;
   event.preventDefault();
   if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  const outsideDrop = (event: globalThis.DragEvent) => {
   if (hasDraggedFiles(event.dataTransfer)) {
    event.preventDefault();
    actions.reset();
   }
  };
  const leave = (event: globalThis.DragEvent) => {
   if (event.relatedTarget === null) actions.reset();
  };
  const stop = () => actions.reset();
  window.addEventListener('dragover', outsideDrag);
  window.addEventListener('drop', outsideDrop);
  window.addEventListener('dragleave', leave);
  window.addEventListener('dragend', stop);
  window.addEventListener('blur', stop);
  return () => {
   window.removeEventListener('dragover', outsideDrag);
   window.removeEventListener('drop', outsideDrop);
   window.removeEventListener('dragleave', leave);
   window.removeEventListener('dragend', stop);
   window.removeEventListener('blur', stop);
  };
 }, [actions]);

 return {
  overlay: dropOverlayVisible(dragging, accepting),
  handlers: {
   enter: (event: DragEvent<HTMLElement>) => actions.enter(event, accepting),
   over: (event: DragEvent<HTMLElement>) => actions.over(event, accepting),
   leave: actions.leave,
   drop: (event: DragEvent<HTMLElement>) => actions.drop(event, {accepting, onFiles})
  }
 };
}

export type AttachmentDropZoneModel = ReturnType<typeof useAttachmentDropZone>;
