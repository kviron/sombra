import {useRef} from 'react';
import {Dialog} from 'radix-ui';
import Cropper from 'react-easy-crop';
import type {ImageKind, PreparedProfileImage} from '../../lib/image-crop';
import {useImageCropDialog} from './use-image-crop-dialog';
import './image-crop-dialog.css';

export type ImageCropDialogProps = {
 file: File;
 kind: ImageKind;
 onConfirm: (result: PreparedProfileImage) => Promise<void> | void;
 onClose: () => void;
};

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
    <Dialog.Overlay className="image-crop-overlay" />
    <Dialog.Content
     className="image-crop-dialog"
     data-image-crop-dialog
     aria-busy={model.busy}
     onEscapeKeyDown={event => event.stopPropagation()}
    >
     <header>
      <Dialog.Title>{kind === 'avatar' ? 'Настроить аватар' : 'Настроить обложку'}</Dialog.Title>
      <Dialog.Description>Перетащите изображение и настройте масштаб. Стрелки перемещают кадр.</Dialog.Description>
     </header>
     <div className={`image-crop-stage image-crop-stage--${kind}`}>
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
       !model.error && <p role="status">Загрузка изображения…</p>
      )}
     </div>
     {model.animated && (
      <p className="image-crop-note">
       Анимация сохранится. Кадрирование применяется при показе, исходный GIF не изменяется.
      </p>
     )}
     <div className="image-crop-controls">
      <label htmlFor={zoomId}>Масштаб</label>
      <input
       id={zoomId}
       type="range"
       min="1"
       max="4"
       step="0.01"
       value={model.zoom}
       onChange={event => actions.setZoom(Number(event.target.value))}
       disabled={!model.image || model.busy}
      />
      <output htmlFor={zoomId}>{model.zoomText}</output>
      <button type="button" disabled={!model.image || model.busy} onClick={actions.resetView}>
       Сбросить
      </button>
     </div>
     {model.error && (
      <p className="image-crop-error" role="alert">
       {model.error}
      </p>
     )}
     <footer>
      <button type="button" onClick={actions.close}>
       Отмена
      </button>
      <button type="button" className="image-crop-apply" disabled={!model.canApply} onClick={actions.apply}>
       {model.busy ? 'Сохранение…' : 'Применить'}
      </button>
     </footer>
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 );
}
