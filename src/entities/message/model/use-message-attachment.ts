import {useEffect, useRef, useState, type RefObject} from 'react';
import {useStore} from 'zustand';
import type {AttachmentFile, MessageAttachmentMetadata} from '@/shared/types';
import {attachmentCategory} from './conversation-materials';
import {attachmentPreviews, previewScope, syncPreviewScope} from './attachment-preview';
import type {AttachmentPreviewCache} from './attachment-preview-cache';
import {createMessageAttachmentModel} from './message-attachment';
import {
 attachmentAvailable,
 attachmentBlob,
 attachmentIdentity,
 imageMimes,
 isImageMime
} from './message-attachment-rules';
import {messageService} from './services/message-service';

type Options = {
 messageId: string;
 attachment: MessageAttachmentMetadata;
 root: RefObject<HTMLDivElement | null>;
};

/**
 * Единственное место логики вложения: доступность, ленивый предпросмотр и скачивание.
 * Компонент получает готовые данные и колбэки.
 */
export function useMessageAttachment({messageId, attachment, root}: Options) {
 const [model] = useState(createMessageAttachmentModel);
 const state = useStore(model.store);
 const alive = useRef(true);
 const lease = useRef<ReturnType<AttachmentPreviewCache['acquire']> | undefined>(undefined);
 const isImage = isImageMime(attachment.mime);
 const isAudio = !isImage && attachmentCategory(attachment.name, attachment.mime) === 'audio';
 const available = attachmentAvailable(attachment);
 const previewActive = state.visible || state.open;
 const scope = previewScope();
 const identity = attachmentIdentity(scope, messageId, attachment);
 const shownPreview = state.previewIdentity === identity ? state.preview : undefined;

 useEffect(() => {
  alive.current = true;
  return () => {
   alive.current = false;
  };
 }, []);

 // Пока картинка не попала в окно, запрос не отправляется.
 useEffect(() => {
  if (!isImage || !available) return;
  const element = root.current;
  if (!element) return;
  if (typeof IntersectionObserver === 'undefined') {
   model.actions.setVisible(true);
   return;
  }
  let scrollRoot: HTMLElement | null = element.parentElement;
  while (scrollRoot && !/(auto|scroll)/.test(getComputedStyle(scrollRoot).overflowY))
   scrollRoot = scrollRoot.parentElement;
  const observer = new IntersectionObserver(
   entries => model.actions.setVisible(entries.some(entry => entry.isIntersecting)),
   {root: scrollRoot, rootMargin: '600px 0px'}
  );
  const viewportObserver = new IntersectionObserver(
   entries => model.actions.setInViewport(entries.some(entry => entry.isIntersecting)),
   {root: scrollRoot}
  );
  observer.observe(element);
  viewportObserver.observe(element);
  return () => {
   observer.disconnect();
   viewportObserver.disconnect();
  };
 }, [isImage, available, root]);

 // Предпросмотр идёт через общий кэш; устаревшие ответы гасит область аккаунта.
 useEffect(() => {
  syncPreviewScope();
  model.actions.startPreview(identity);
  if (!isImage || !available) return;
  let current = true;
  const owner = {
   active: false,
   priority: 0,
   notify: (url: string | undefined, reason?: unknown) => {
    if (!current) return;
    model.actions.setPreview(url, reason);
   }
  };
  const handle = attachmentPreviews.acquire(
   identity,
   owner,
   () => messageService.attachment<AttachmentFile>({message: messageId}),
   value => {
    const file = value as AttachmentFile;
    // Растровый MIME проверяется до кэша: SVG, HTML и внешние ссылки не принимаются.
    if (!imageMimes.has(file.mime)) throw new Error('Предпросмотр этого файла недоступен.');
    return attachmentBlob(file);
   },
   () => previewScope() === scope
  );
  lease.current = handle;
  const reset = () => {
   current = false;
   handle.release();
   model.actions.setPreview(undefined);
   model.actions.setOpen(false);
  };
  window.addEventListener('authchange', reset);
  window.addEventListener('attachmentcachechange', reset);
  return () => {
   current = false;
   handle.release();
   if (lease.current === handle) lease.current = undefined;
   window.removeEventListener('authchange', reset);
   window.removeEventListener('attachmentcachechange', reset);
  };
 }, [identity, isImage, available, state.retry]);

 // Приоритет загрузки: открытый просмотр важнее прокрутки.
 useEffect(() => {
  lease.current?.update(previewActive, state.open ? 3 : state.inViewport ? 2 : 1);
 }, [previewActive, state.open, state.inViewport, identity, isImage, available, state.retry]);

 useEffect(() => {
  if (!available || !isImage) model.actions.setOpen(false);
 }, [available, isImage]);

 return {
  isImage,
  isAudio,
  available,
  preview: shownPreview,
  error: state.error,
  busy: state.busy,
  open: state.open,
  actions: {
   setOpen: model.actions.setOpen,
   setError: model.actions.setError,
   retry: model.actions.retryLoad,
   download: () => model.actions.download({messageId, available, isAlive: () => alive.current})
  }
 };
}
