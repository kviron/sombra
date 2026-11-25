import {TooltipLabel} from '@/shared/ui/tooltip';
import {useEffect, useState} from 'react';
import {AppWindow, Monitor} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import type {DesktopPresentationSource} from '@/shared/types/presentation';
import {desktopPresentation} from '../model/services/desktop-presentation';

export function PresentationSources({
 sources,
 busy,
 onSelect
}: {
 sources: DesktopPresentationSource[];
 busy: boolean;
 onSelect: (id: string) => void;
}) {
 const [previews, setPreviews] = useState<Record<string, string>>({});
 useEffect(() => {
  let active = true;
  const urls: string[] = [];
  async function loadPreviews() {
   for (const source of sources) {
    const preview = await desktopPresentation.preview(source.id).catch(() => undefined);
    if (!active) return;
    if (!preview) continue;
    const url = URL.createObjectURL(preview);
    urls.push(url);
    setPreviews(current => ({...current, [source.id]: url}));
   }
  }
  void loadPreviews();
  return () => {
   active = false;
   urls.forEach(url => URL.revokeObjectURL(url));
  };
 }, [sources]);

 if (!sources.length) return <p className="text-sm text-white/70">Доступных источников нет.</p>;

 return (
  <div className="grid gap-3 sm:grid-cols-2">
   {sources.map(source => {
    const Icon = source.kind === 'window' ? AppWindow : Monitor;
    const preview = previews[source.id];
    return (
     <Button
      key={source.id}
      type="button"
      variant="ghost"
      disabled={busy}
      aria-label={`Демонстрировать: ${source.title}`}
      className="group/source h-auto min-w-0 flex-col items-stretch gap-2 rounded-xl p-2 text-left hover:bg-white/10 hover:text-white dark:hover:bg-white/10"
      onClick={() => onSelect(source.id)}
     >
      <span className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-lg bg-white/5">
       {preview ? (
        <img className="absolute inset-0 size-full object-contain" src={preview} alt="" />
       ) : (
        <Icon className="text-white/65" aria-hidden="true" />
       )}
       <span className="absolute bottom-2 left-2 rounded-md bg-black/80 px-2 py-1 text-xs text-white sm:opacity-0 sm:group-hover/source:opacity-100 sm:group-focus-visible/source:opacity-100">
        Демонстрировать
       </span>
      </span>
      <TooltipLabel content={source.title}>
       <span className="truncate px-1">{source.title}</span>
      </TooltipLabel>
     </Button>
    );
   })}
  </div>
 );
}
