import {Settings2} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import {
 presentationCaptureQuality,
 presentationFrameRates,
 presentationProfiles,
 presentationResolutions,
 type PresentationQuality
} from '../model/presentation-quality';

export function PresentationQualitySettings({
 quality,
 disabled,
 onChange
}: {
 quality: PresentationQuality;
 disabled: boolean;
 onChange: (quality: PresentationQuality) => void;
}) {
 const {height, frameRate} = presentationCaptureQuality(quality);
 return (
  <section className="mt-4 shrink-0 border-t border-white/15 pt-3" aria-label="Качество демонстрации">
   <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex items-center gap-2">
     <Settings2 className="size-4 text-white/70" aria-hidden="true" />
     <div>
      <h3 className="text-sm font-medium">Качество видео</h3>
      <p className="text-xs text-white/70">
       {height}p · до {frameRate} к/с
      </p>
     </div>
    </div>
    <div className="flex flex-wrap gap-1" role="group" aria-label="Режим демонстрации">
     {presentationProfiles.map(profile => (
      <Button
       key={profile.id}
       type="button"
       variant={quality.profile === profile.id ? 'secondary' : 'ghost'}
       size="sm"
       disabled={disabled}
       aria-pressed={quality.profile === profile.id}
       onClick={() => onChange({...quality, profile: profile.id})}
      >
       {profile.label}
      </Button>
     ))}
    </div>
   </div>
   {quality.profile === 'custom' && (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
     <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1 text-xs text-white/70">Разрешение</legend>
      <div className="flex flex-wrap gap-1">
       {presentationResolutions.map(height => (
        <Button
         key={height}
         type="button"
         variant={quality.height === height ? 'secondary' : 'ghost'}
         size="sm"
         aria-pressed={quality.height === height}
         onClick={() => onChange({...quality, height})}
        >
         {height}p
        </Button>
       ))}
      </div>
     </fieldset>
     <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1 text-xs text-white/70">Кадров в секунду</legend>
      <div className="flex flex-wrap gap-1">
       {presentationFrameRates.map(frameRate => (
        <Button
         key={frameRate}
         type="button"
         variant={quality.frameRate === frameRate ? 'secondary' : 'ghost'}
         size="sm"
         aria-pressed={quality.frameRate === frameRate}
         onClick={() => onChange({...quality, frameRate})}
        >
         {frameRate}
        </Button>
       ))}
      </div>
     </fieldset>
    </div>
   )}
  </section>
 );
}
