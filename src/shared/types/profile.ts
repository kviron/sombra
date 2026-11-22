/** Обложка и украшения профиля: сервер отдаёт только белый список полей. */
export type ImageCropArea = {x: number; y: number; width: number; height: number};
export type ProfileCoverMetadata = {
 id: string;
 mime: string;
 width: number;
 height: number;
 crop: ImageCropArea;
 animated: boolean;
 bytes: number;
};
export type ProfileCoverFile = ProfileCoverMetadata & {user: string; data: string};
/** Документ украшения профиля v1: пиксельная рамка аватара или сцена обложки. Разбор и проверка — avatar-fx/normalize.ts. */
export type ProfileDecorationDoc = {
 v?: unknown;
 target?: unknown;
 mode?: unknown;
 loop?: unknown;
 seed?: unknown;
 layers?: unknown;
};
/** Украшения профиля по целям. Поле отсутствует — украшения нет; неизвестные цели сервер не отдаёт. */
export type ProfileDecorations = {avatar?: ProfileDecorationDoc; cover?: ProfileDecorationDoc};
export type ProfileEffectTarget = keyof ProfileDecorations;
export type ProfileEffectScope = 'personal' | 'catalog';
export type ProfileEffectRefs = Partial<Record<ProfileEffectTarget, string>>;
export type ProfileEffectAsset = {
 id: string;
 mime: 'image/gif';
 width: number;
 height: number;
 frames: number;
 size: number;
};
export type ProfileEffect = {
 id: string;
 target: ProfileEffectTarget;
 title: string;
 decoration: ProfileDecorationDoc | null;
 asset?: ProfileEffectAsset;
 ownerId: string;
 public: boolean;
};
export type ProfileEffectDraft = {
 id: string;
 status: 'queued' | 'running' | 'ready' | 'failed';
 result?: {title: string; decoration: ProfileDecorationDoc};
 error?: string;
};
export type ProfileDto = {name: string; bio: string};
