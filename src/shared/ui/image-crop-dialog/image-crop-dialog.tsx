import {useRef} from 'react';
import {Dialog} from 'radix-ui';
import Cropper from 'react-easy-crop';
import type {ImageKind, PreparedProfileImage} from '../../lib/image-crop';
import {cn} from '@/shared/lib/utils';
import {useImageCropDialog} from './use-image-crop-dialog';
import './image-crop-dialog.css';

export type ImageCropDialogProps = {
 file: File;
 kind: ImageKind;
 onConfirm: (result: PreparedProfileImage) => Promise<void> | void;
 onClose: () => void;
};

/** Общая кнопка окна кадрирования: «Сбросить», «Отмена» и «Применить» различаются только акцентом. */
const dialogButton = cn(
 'min-h-11 cursor-pointer rounded-[8px] border px-4 py-2',
 'disabled:cursor-not-allowed disabled:opacity-50'
);
const plainButton = cn(
 dialogButton,
 'border-[var(--border,#55565f)] bg-transparent text-inherit enabled:hover:bg-[#ffffff12]'
);
const applyButton = cn(
 dialogButton,
 'image-crop-apply border-transparent bg-[var(--accent,#a79cf7)] font-semibold text-[#14121f]',
 'enabled:hover:bg-[var(--accent,#a79cf7)] enabled:hover:brightness-[1.08]'
);

/**
 * Окно кадрирования только показывает: предпросмотр, кадр и сохранение
 * приходят из модели рядом с компонентом.
 */
export function ImageCropDialog({file, kind, onConfirm, onClose}: ImageCropDialogProps) {
 const model = useImageCropDialog({file, kind, onConfirm, onClose});
 const zoomId = useRef(`crop-zoom-${Math.random().toString(36).slice(2)}`).current;
 const {actions} = model;

 return (
  <Dialog.Root
   open
   onOpenChange={open => {
    if (!open) actions.close();
   }}
  >
   <Dialog.Portal>
    <Dialog.Overlay className="image-crop-overlay fixed inset-0 z-[1100] bg-[#000b]" />
    <Dialog.Content
     className={cn(
      'image-crop-dialog',
      'fixed top-1/2 left-1/2 z-[1101] box-border max-h-[calc(100dvh_-_32px)] w-[min(720px,calc(100vw_-_32px))]',
      'overflow-auto rounded-[16px] border border-[var(--border,#42434a)] bg-[var(--surface,#202127)] p-6',
      '[transform:translate(-50%,-50%)] [font-family:inherit] text-[var(--text,#f5f5f7)] [box-shadow:0_24px_80px_#0008]'
     )}
     data-image-crop-dialog
     aria-busy={model.busy}
     onEscapeKeyDown={event => event.stopPropagation()}
    >
     <header>
      <Dialog.Title className="m-0 mb-2 text-xl leading-[1.3]">
       {kind === 'avatar' ? 'Настроить аватар' : 'Настроить обложку'}
      </Dialog.Title>
      <Dialog.Description className="m-0 mb-4 text-[14px] leading-[1.5] text-[var(--text-secondary,#c4c5ce)]">
       Перетащите изображение и настройте масштаб. Стрелки перемещают кадр.
      </Dialog.Description>
     </header>
     <div
      className={cn(
       'image-crop-stage relative overflow-hidden rounded-[8px] bg-[#111217]',
       kind === 'avatar' ? 'h-[360px]' : 'h-80'
      )}
     >
      {model.image ? (
       <Cropper
        image={model.image}
        crop={model.position}
        zoom={model.zoom}
        aspect={model.aspect}
        cropShape={model.shape}
        showGrid={model.grid}
        onCropChange={actions.setPosition}
        onZoomChange={actions.setZoom}
        onCropComplete={actions.completed}
        minZoom={1}
        maxZoom={4}
        keyboardStep={10}
        cropperProps={{'aria-label': 'Кадрирование изображения: перемещение стрелками', 'aria-disabled': model.busy}}
        zoomWithScroll={!model.busy}
        onMediaLoaded={() => actions.clearError()}
        style={{containerStyle: {pointerEvents: model.busy ? 'none' : undefined}}}
        mediaProps={{
         onError: () => actions.decoderFailed(),
         alt: kind === 'avatar' ? 'Предпросмотр аватара' : 'Предпросмотр обложки'
        }}
       />
      ) : (
       !model.error && (
        <p className="p-6" role="status">
         Загрузка изображения…
        </p>
       )
      )}
     </div>
     {model.animated && (
      <p className="image-crop-note m-0 mt-3 text-[14px] leading-[1.5] text-[var(--text-secondary,#c4c5ce)]">
       Анимация сохранится. Кадрирование применяется при показе, исходный GIF не изменяется.
      </p>
     )}
     <div className="image-crop-controls mt-4 flex items-center gap-3 text-[14px]">
      <label htmlFor={zoomId}>Масштаб</label>
      <input
       id={zoomId}
       type="range"
       className="h-11 min-w-[40px] flex-1 accent-[var(--accent,#a79cf7)]"
       min="1"
       max="4"
       step="0.01"
       value={model.zoom}
       onChange={event => actions.setZoom(Number(event.target.value))}
       disabled={!model.image || model.busy}
      />
      <output className="min-w-11 text-right" htmlFor={zoomId}>
       {model.zoomText}
      </output>
      <button type="button" className={plainButton} disabled={!model.image || model.busy} onClick={actions.resetView}>
       Сбросить
      </button>
     </div>
     {model.error && (
      <p className="image-crop-error text-[14px] leading-[1.5] text-[#ffb4b4]" role="alert">
       {model.error}
      </p>
     )}
     <footer className="mt-6 flex justify-end gap-3">
      <button type="button" className={plainButton} onClick={actions.close}>
       Отмена
      </button>
      <button type="button" className={applyButton} disabled={!model.canApply} onClick={actions.apply}>
       {model.busy ? 'Сохранение…' : 'Применить'}
      </button>
     </footer>
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
