import {api} from '@/shared/api';
import type {StickerImageResponse} from '@/shared/types';

/** Стикеры: картинки, публичные наборы и их установка. */
export const stickerService = {
 image: (payload: {sticker: string}) => api.sticker.image<StickerImageResponse>(payload),
 thumbnail: (payload: {sticker: string}) => api.sticker.thumbnail<StickerImageResponse>(payload),
 listPublicPacks: <T = unknown>(payload: Record<string, unknown> = {}) => api.sticker.listPublicPacks<T>(payload),
 installPublicPack: (payload: Record<string, unknown>) => api.sticker.installPublicPack(payload),
 importPack: (payload: Record<string, unknown>) => api.sticker.importPack(payload),
 removeInstalledPack: (payload: Record<string, unknown>) => api.sticker.removeInstalledPack(payload),
 setPackPublic: (payload: Record<string, unknown>) => api.sticker.setPackPublic(payload),
 // Сервер удаляет либо один стикер, либо весь набор — различает поле `sticker`.
 remove: (payload: {group?: string; pack: string; sticker?: string}) =>
  payload.sticker ? api.sticker.removeSticker(payload) : api.sticker.removePack(payload)
};
