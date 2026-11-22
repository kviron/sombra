// Публичные наборы стикеров: форма ответа сервера и запрос каталога.
import type {Sticker} from '@/shared/types';
import {stickerService} from './services/sticker-service';

export type PublicPack = {
 id: string;
 name: string;
 owner: string;
 count: number;
 installed: boolean;
 stickers: Sticker[];
};

export const listPublicPacks = (options: {packId?: string; offset?: number} = {}) =>
 stickerService.listPublicPacks<{packs: PublicPack[]; nextOffset: number | null}>(options);
