// Чистые правила окна кадрирования: пропорции, уменьшение предпросмотра и готовность к сохранению.
// Файл импортирует только типы: так его читает node --experimental-strip-types.
import type {Area} from 'react-easy-crop';
import type {ImageKind, NormalizedCrop} from '../../lib/image-crop';

/** Пропорции кадра: аватар квадратный, обложка 3:1. */
export const cropAspect = (kind: ImageKind) => (kind === 'avatar' ? 1 : 3);

/** Форма кадра: аватар круглый, обложка прямоугольная. */
export const cropShape = (kind: ImageKind): 'round' | 'rect' => (kind === 'avatar' ? 'round' : 'rect');

/** Сетка помогает поймать горизонт только на обложке. */
export const cropGrid = (kind: ImageKind) => kind === 'cover';

/** Длинная сторона предпросмотра: больше браузеру для кадрирования не нужно. */
export const previewMaxSide = 2048;

/**
 * Размер холста предпросмотра. Если округление сломало пропорции больше чем на 0.5%,
 * берём исходные размеры: верный кадр важнее экономии памяти.
 */
export function previewSize(width: number, height: number, maxSide = previewMaxSide) {
 const scale = Math.min(1, maxSide / Math.max(width, height));
 const target = {
  width: Math.max(1, Math.round(width * scale)),
  height: Math.max(1, Math.round(height * scale))
 };
 const drift = Math.abs(target.width / target.height / (width / height) - 1);
 return drift > 0.005 ? {width, height} : target;
}

/** Кадр react-easy-crop уже приходит в процентах от изображения. */
export const cropFromArea = (area: Area): NormalizedCrop => ({
 x: area.x,
 y: area.y,
 width: area.width,
 height: area.height
});

/** Сохранять можно только когда изображение открыто, кадр известен и ничего не выполняется. */
export const canApplyCrop = (image: string, crop: NormalizedCrop | null, busy: boolean) => !!image && !!crop && !busy;

export const zoomPercent = (zoom: number) => `${Math.round(zoom * 100)}%`;

/** Сброс вида: кадр по центру и масштаб 1. */
export const initialCropView = () => ({
 position: {x: 0, y: 0},
 zoom: 1,
 crop: null as NormalizedCrop | null
});

/** Анимация сохраняется: для GIF кадрирование применяется при показе, а байты не меняются. */
export const isAnimatedImage = (info: {mime: string} | null | undefined) => info?.mime === 'image/gif';

export const openErrorMessage = (reason: unknown) =>
 reason instanceof Error ? reason.message : 'Не удалось открыть изображение';

export const applyErrorMessage = (reason: unknown) =>
 reason instanceof Error ? reason.message : 'Не удалось сохранить изображение';
