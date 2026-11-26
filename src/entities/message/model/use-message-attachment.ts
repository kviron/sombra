import {useEffect, useRef, useState, type RefObject} from 'react';
import {useStore} from 'zustand';
import type {AttachmentFile, MessageAttachmentMetadata} from '@/shared/types';
import {attachmentCategory} from './conversation-materials';
import {attachmentPreviews, previewScope, syncPreviewScope} from './attachment-preview';
import {hasImageSize} from './attachment-preview-cache';
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
 const viewportObserver = useRef<IntersectionObserver | undefined>(undefined);
 const isImage = isImageMime(attachment.mime);
 const isAudio = !isImage && attachmentCategory(attachment.name, attachment.mime) === 'audio';
 const available = attachmentAvailable(attachment);
 const scope = previewScope();
 const identity = attachmentIdentity(scope, messageId, attachment);
 const samePreview = state.previewIdentity === identity;
 const shownPreview = samePreview ? state.preview : undefined;
 const imageSize = hasImageSize(attachment)
  ? attachment
  : samePreview
    ? state.imageSize
    : attachmentPreviews.imageSize(identity);

 useEffect(() => {
  alive.current = true;
  return () => {
   alive.current = false;
  };
 }, []);

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
   () => messageService.attachment<AttachmentFile>({message: messageId, attachment_id: attachment.id}),
   value => {
    const file = value as AttachmentFile;
    // Растровый MIME проверяется до кэша: SVG, HTML и внешние ссылки не принимаются.
    if (!imageMimes.has(file.mime)) throw new Error('Предпросмотр этого файла недоступен.');
    return attachmentBlob(file);
   },
   () => previewScope() === scope
  );
  // Proximity starts loading; a visible row keeps its first frame while the image decodes.
  let near = false;
  let visible = false;
  const update = () => {
   if (!current) return;
   const open = model.store.getState().open;
   handle.update(open || near || visible, open ? 3 : visible ? 2 : 1);
  };
  const unsubscribe = model.store.subscribe((next, previous) => {
   if (next.open !== previous.open) update();
  });
  const element = root.current;
  let preloadObserver: IntersectionObserver | undefined;
  if (element && typeof IntersectionObserver !== 'undefined') {
   let scrollRoot: HTMLElement | null = element.parentElement;
   while (scrollRoot && !/(auto|scroll)/.test(getComputedStyle(scrollRoot).overflowY))
    scrollRoot = scrollRoot.parentElement;
   preloadObserver = new IntersectionObserver(
    entries => {
     near = entries[entries.length - 1].isIntersecting;
     update();
    },
    {root: scrollRoot, rootMargin: '600px 0px'}
   );
   viewportObserver.current = new IntersectionObserver(
    entries => {
     if (!current) return;
     visible = entries[entries.length - 1].isIntersecting;
     if (!visible) {
      const size = attachmentPreviews.imageSize(identity);
      if (size) model.actions.applyImageSize(size);
     }
     update();
    },
    {root: scrollRoot}
   );
   preloadObserver.observe(element);
   viewportObserver.current.observe(element);
  } else {
   near = true;
  }
  update();
  const release = () => {
   if (!current) return;
   current = false;
   unsubscribe();
   preloadObserver?.disconnect();
   viewportObserver.current?.disconnect();
   viewportObserver.current = undefined;
   handle.release();
  };
  const reset = () => {
   release();
   model.actions.startPreview('');
   model.actions.setOpen(false);
  };
  window.addEventListener('authchange', reset);
  window.addEventListener('attachmentcachechange', reset);
  return () => {
   release();
   window.removeEventListener('authchange', reset);
   window.removeEventListener('attachmentcachechange', reset);
  };
 }, [model, root, identity, scope, messageId, isImage, available, state.retry]);

 useEffect(() => {
  if (!available || !isImage) model.actions.setOpen(false);
 }, [available, isImage, model]);

 return {
  isImage,
  imageSize,
  isAudio,
  available,
  preview: shownPreview,
  error: state.error,
  busy: state.busy,
  copying: state.copying,
  copyError: state.copyError,
  open: state.open,
  actions: {
   rememberImageSize: (image: HTMLImageElement) => {
    if (
     imageSize ||
     !attachmentPreviews.rememberImageSize(identity, image.currentSrc, {
      width: image.naturalWidth,
      height: image.naturalHeight
     })
    )
     return;
    // Recheck even if the photo finished loading while already outside the viewport.
    if (root.current && viewportObserver.current) {
     viewportObserver.current.unobserve(root.current);
     viewportObserver.current.observe(root.current);
    }
   },
   setOpen: model.actions.setOpen,
   setError: model.actions.setError,
   retry: model.actions.retryLoad,
   copy: () =>
    model.actions.copy({
     preview: shownPreview,
     available,
     mime: attachment.mime,
     isAlive: () => alive.current
    }),
   download: () =>
    model.actions.download({messageId, attachmentId: attachment.id, available, isAlive: () => alive.current})
  }
 };
}
