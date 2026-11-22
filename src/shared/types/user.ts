import type {BotCommand} from './bot';
import type {
 ProfileCoverMetadata,
 ProfileDecorations,
 ProfileEffectAsset,
 ProfileEffectRefs,
 ProfileEffectTarget
} from './profile';

export type SessionDto = {
 id: string;
 device: string;
 created_at: number;
 last_seen: number;
 expires_at: number;
 current: boolean;
};
export type User = {
 id: string;
 name: string;
 bio: string;
 avatar?: string;
 /** Content hash of the avatar when the server withholds the inline picture. */ avatarHash?: string;
 coverSupported?: boolean;
 decorationSupported?: boolean;
 cover?: ProfileCoverMetadata;
 decorations?: ProfileDecorations;
 decorationRefs?: ProfileEffectRefs;
 profileEffectAssets?: Partial<Record<ProfileEffectTarget, ProfileEffectAsset>>;
 created_at: number;
 online?: boolean;
 last_seen?: number;
 bot?: boolean;
 username?: string;
 commands?: BotCommand[];
};
