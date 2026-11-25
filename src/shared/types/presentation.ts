export type DesktopPresentationSource = {
 id: string;
 kind: 'window' | 'monitor';
 title: string;
};

export type PresentationCaptureQuality = {width: number; height: number; frameRate: number};
