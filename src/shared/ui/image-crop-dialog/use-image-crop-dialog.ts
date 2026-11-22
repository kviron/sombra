import {useEffect, useState} from 'react';
import {useStore} from 'zustand';
import type {Area} from 'react-easy-crop';
import type {ImageKind, PreparedProfileImage} from '../../lib/image-crop';
import {createImageCropDialogModel} from './image-crop-dialog-model';
import {canApplyCrop, cropAspect, cropGrid, cropShape, isAnimatedImage, zoomPercent} from './image-crop-dialog-rules';

type Options = {
 file: File;
 kind: ImageKind;
 onConfirm: (result: PreparedProfileImage) => Promise<void> | void;
 onClose: () => void;
};

/**
 * Единственное место, где живёт логика кадрирования: открытие с уменьшением предпросмотра,
 * кадр, масштаб и сохранение. Компонент получает данные и колбэки.
 */
export function useImageCropDialog({file, kind, onConfirm, onClose}: Options) {
 const [model] = useState(createImageCropDialogModel);
 const state = useStore(model.store);
 const {actions} = model;

 // Смена файла и размонтирование освобождают предпросмотр: объектный URL живёт окно.
 useEffect(() => {
  void actions.load(file, kind);
  return () => actions.dispose();
 }, [actions, file, kind]);

 return {
  image: state.image,
  info: state.info,
  position: state.position,
  zoom: state.zoom,
  crop: state.crop,
  busy: state.busy,
  error: state.error,
  animated: isAnimatedImage(state.info),
  aspect: cropAspect(kind),
  shape: cropShape(kind),
  grid: cropGrid(kind),
  zoomText: zoomPercent(state.zoom),
  canApply: canApplyCrop(state.image, state.crop, state.busy),
  actions: {
   close() {
    actions.dispose();
    onClose();
   },
   apply() {
    void actions.apply({file, kind, onConfirm});
   },
   setPosition: actions.setPosition,
   setZoom: actions.setZoom,
   resetView: actions.resetView,
   completed(area: Area) {
    actions.cropCompleted(area);
   },
   clearError: actions.clearError,
   decoderFailed: actions.decoderFailed
  }
 };
}

export type ImageCropDialogModel = ReturnType<typeof useImageCropDialog>;
