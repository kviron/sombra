import {useEffect, useRef, useState, type RefObject} from 'react';
import {useStore} from 'zustand';
import {attachmentDownloadFailure} from '@/shared/lib/attachment-errors';
import {verifiedMediaBlob} from '@/shared/lib/attachment-media';
import type {AttachmentFile, MessageAttachmentMetadata} from '@/shared/types';
import {attachmentPreviews, previewScope, syncPreviewScope} from './attachment-preview';
import type {AttachmentPreviewCache} from './attachment-preview-cache';
import {createAttachmentAudioModel} from './attachment-audio';
import {attachmentIdentity} from './message-attachment-rules';
import {messageService} from './services/message-service';

type Options = {
 messageId: string;
 attachment: MessageAttachmentMetadata;
 root: RefObject<HTMLDivElement | null>;
};

/**
 * Аудио: байты декодируются один раз через общий кэш, играет только подтверждённый формат.
 * Компонент получает готовый URL, состояние плеера и колбэки.
 */
export function useAttachmentAudio({messageId, attachment, root}: Options) {
 const [model] = useState(createAttachmentAudioModel);
 const state = useStore(model.store);
 const alive = useRef(true);
 const lease = useRef<ReturnType<AttachmentPreviewCache['acquire']> | undefined>(undefined);
 const scope = previewScope();
 const identity = attachmentIdentity(scope, messageId, attachment, 'audio');
 const shownUrl = state.identity === identity ? state.url : undefined;
 const pinned = state.visible || state.playing;

 useEffect(() => {
  alive.current = true;
  return () => {
   alive.current = false;
  };
 }, []);

 // Аудио грузится, когда карточка попала в окно, и держится, пока играет.
 useEffect(() => {
  const element = root.current;
  if (!element) return;
  if (typeof IntersectionObserver === 'undefined') {
   model.actions.setVisible(true);
   model.actions.setInViewport(true);
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
 }, [root]);

 // Загрузка через общий кэш: один запрос на файл, устаревшие ответы гасит область аккаунта.
 useEffect(() => {
  syncPreviewScope();
  model.actions.startPreview(identity);
  let current = true;
  const owner = {
   active: false,
   priority: 0,
   notify: (next: string | undefined, reason?: unknown) => {
    if (!current) return;
    model.actions.setUrl(next);
    if (reason) model.actions.setError(attachmentDownloadFailure(reason, 'Не удалось загрузить аудио.').message);
   }
  };
  const handle = attachmentPreviews.acquire(
   identity,
   owner,
   () => messageService.attachment<AttachmentFile>({message: messageId}),
   value => {
    const blob = verifiedMediaBlob(value as AttachmentFile, attachment, 'audio');
    if (!document.createElement('audio').canPlayType(blob.type))
     throw new Error('Этот формат не поддерживается браузером. Скачайте файл.');
    return blob;
   },
   () => previewScope() === scope
  );
  lease.current = handle;
  const reset = () => {
   current = false;
   handle.release();
   model.actions.setUrl(undefined);
   model.actions.setPlaying(false);
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
 }, [identity, state.retry]);

 useEffect(() => {
  lease.current?.update(pinned, pinned ? (state.inViewport ? 2 : 1) : 0);
 }, [pinned, state.inViewport, identity, state.retry]);

 return {
  url: shownUrl,
  error: state.error,
  failed: state.failed,
  playing: state.playing,
  busy: state.busy,
  visible: state.visible,
  actions: {
   setPlaying: model.actions.setPlaying,
   playbackFailed: () => {
    if (alive.current) model.actions.playbackFailed();
   },
   retry: model.actions.retryLoad,
   download: () => model.actions.download({messageId, isAlive: () => alive.current})
  }
 };
}
