import {api} from '../api';
import type {ProfileEffectAsset} from '../backend';

/**
 * Файлы профиля: картинки нужны и `shared/ui`, а shared не может импортировать из сущностей.
 * Файл украшения читает `shared/ui/profile-effect-image`, поэтому он тоже здесь.
 */
export const fileService = {
 avatar: <T = unknown>(payload: Record<string, unknown>) => api.file.avatar<T>(payload),
 cover: <T = unknown>(payload: Record<string, unknown>) => api.file.cover<T>(payload),
 profileEffect: <T = {asset: ProfileEffectAsset; data: string}>(id: string) => api.profileEffect.file<T>({id})
};
