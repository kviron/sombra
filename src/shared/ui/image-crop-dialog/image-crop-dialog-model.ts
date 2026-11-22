// Хранилище одного окна кадрирования: предпросмотр, кадр, масштаб и сохранение.
// Модель создаётся на открытое окно: два кадрирования одновременно не делят предпросмотр.
import {createStore} from 'zustand/vanilla';
import {
 prepareCroppedImage,
 readImageSource,
 type ImageKind,
 type ImageSourceInfo,
 type NormalizedCrop,
 type PreparedProfileImage
} from '../../lib/image-crop';
import {
 applyErrorMessage,
 canApplyCrop,
 cropFromArea,
 initialCropView,
 openErrorMessage,
 previewSize
} from './image-crop-dialog-rules';

export type ImageCropDialogState = {
 image: string;
 info: ImageSourceInfo | null;
 position: {x: number; y: number};
 zoom: number;
 crop: NormalizedCrop | null;
 busy: boolean;
 error: string;
};

const initialState: ImageCropDialogState = {
 image: '',
 info: null,
 position: {x: 0, y: 0},
 zoom: 1,
 crop: null,
 busy: false,
 error: ''
};

export type ApplyArgs = {
 file: File;
 kind: ImageKind;
 onConfirm: (result: PreparedProfileImage) => Promise<void> | void;
};

export function createImageCropDialogModel() {
 const store = createStore<ImageCropDialogState>(() => initialState);
 /** Поколение открытия: ответ декодера прошлого файла не должен перебить новый. */
 let epoch = 0;
 let saving = false;
 let closed = false;
 let activeUrl = '';

 const revoke = () => {
  if (activeUrl) URL.revokeObjectURL(activeUrl);
  activeUrl = '';
 };

 const actions = {
  /** Открытие файла: заголовок проверяется до декодера, предпросмотр уменьшается до 2048 px. */
  async load(file: File, kind: ImageKind) {
   const current = ++epoch;
   closed = false;
   saving = false;
   store.setState(initialState);
   try {
    const source = await readImageSource(file, kind);
    if (epoch !== current) return;
    let blob: Blob = file;
    if (source.info.mime !== 'image/gif') {
     const bitmap = await createImageBitmap(new Blob([source.bytes as BlobPart], {type: source.info.mime}), {
      imageOrientation: 'from-image'
     });
     try {
      if (epoch !== current) return;
      if (bitmap.width !== source.info.width || bitmap.height !== source.info.height)
       throw new Error('Размер изображения не совпадает с заголовком');
      const size = previewSize(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Не удалось открыть изображение');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const preview = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!preview) throw new Error('Не удалось открыть изображение');
      blob = preview;
     } finally {
      bitmap.close();
     }
    }
    if (epoch !== current) return;
    activeUrl = URL.createObjectURL(blob);
    store.setState({info: source.info, image: activeUrl});
   } catch (reason) {
    if (epoch === current) store.setState({error: openErrorMessage(reason)});
   }
  },

  /** Окно закрылось: незавершённые открытие и сохранение больше не нужны. */
  dispose() {
   closed = true;
   epoch++;
   revoke();
  },

  async apply({file, kind, onConfirm}: ApplyArgs) {
   const {image, crop, busy} = store.getState();
   if (!crop || !canApplyCrop(image, crop, busy) || saving || closed) return;
   saving = true;
   store.setState({busy: true, error: ''});
   const current = epoch;
   try {
    const result = await prepareCroppedImage(file, kind, crop);
    if (epoch !== current || closed) return;
    await onConfirm(result);
   } catch (reason) {
    if (epoch === current && !closed) store.setState({error: applyErrorMessage(reason)});
   } finally {
    if (epoch === current && !closed) {
     saving = false;
     store.setState({busy: false});
    }
   }
  },

  setPosition(position: {x: number; y: number}) {
   store.setState({position});
  },
  setZoom(zoom: number) {
   store.setState({zoom});
  },
  resetView() {
   store.setState(initialCropView());
  },
  cropCompleted(area: {x: number; y: number; width: number; height: number}) {
   store.setState({crop: cropFromArea(area)});
  },
  clearError() {
   store.setState({error: ''});
  },
  /** Браузер не смог декодировать уже открытый предпросмотр. */
  decoderFailed() {
   store.setState({error: 'Не удалось декодировать изображение', image: '', crop: null});
  }
 };

 return {store, actions};
}

export type ImageCropDialogStore = ReturnType<typeof createImageCropDialogModel>;
