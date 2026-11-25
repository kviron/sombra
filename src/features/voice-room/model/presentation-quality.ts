import type {PresentationCaptureQuality} from '@/shared/types/presentation';

const resolutions = {480: 854, 720: 1280, 1080: 1920} as const;
export const presentationFrameRates = [5, 12, 24, 30] as const;
export const presentationResolutions = [480, 720, 1080] as const;
export const presentationProfiles = [
 {id: 'motion', label: 'Движение'},
 {id: 'detail', label: 'Чёткий текст'},
 {id: 'custom', label: 'Вручную'}
] as const;

export type PresentationQuality = {
 profile: (typeof presentationProfiles)[number]['id'];
 height: (typeof presentationResolutions)[number];
 frameRate: (typeof presentationFrameRates)[number];
};

export const defaultPresentationQuality: PresentationQuality = {profile: 'custom', height: 720, frameRate: 12};

export function readPresentationQuality(value: unknown): PresentationQuality {
 if (!value || typeof value !== 'object') return defaultPresentationQuality;
 return {
  profile: presentationProfiles.find(profile => 'profile' in value && profile.id === value.profile)?.id ?? 'custom',
  height: presentationResolutions.find(height => 'height' in value && height === value.height) ?? 720,
  frameRate: presentationFrameRates.find(rate => 'frameRate' in value && rate === value.frameRate) ?? 12
 };
}

export function presentationCaptureQuality(quality: PresentationQuality): PresentationCaptureQuality {
 const height = quality.profile === 'motion' ? 720 : quality.profile === 'detail' ? 1080 : quality.height;
 const frameRate = quality.profile === 'motion' ? 30 : quality.profile === 'detail' ? 5 : quality.frameRate;
 return {width: resolutions[height], height, frameRate};
}
