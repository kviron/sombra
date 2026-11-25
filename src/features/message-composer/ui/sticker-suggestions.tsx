import {TooltipLabel} from '@/shared/ui/tooltip';
import {useEffect, useState} from 'react';
import type {Sticker} from '@/shared/types';
import {findStickerSuggestions} from '@/entities/sticker';
import {StickerImage} from '@/entities/sticker';
import '@/shared/ui/menu-material.css';

export function StickerSuggestions({
 draft,
 stickers,
 user,
 group,
 busy,
 onSelect
}: {
 draft: string;
 stickers: Sticker[];
 user: string;
 group?: string;
 busy: boolean;
 onSelect: (sticker: string, replaceDraft: boolean) => Promise<boolean>;
}) {
 const [dismissed, setDismissed] = useState<string>();
 const [pending, setPending] = useState(false);
 useEffect(() => setDismissed(undefined), [draft]);
 if (!draft || draft === dismissed) return null;
 const matches = findStickerSuggestions(draft, stickers, user, group);
 if (!matches.length) return null;
 async function select(id: string, replaceDraft: boolean) {
  setPending(true);
  try {
   if ((await onSelect(id, replaceDraft)) && !replaceDraft) setDismissed(draft);
  } finally {
   setPending(false);
  }
 }
 return (
  <div
   className="sticker-suggestions sombra-menu-surface absolute bottom-[calc(100%_+_6px)] left-0 z-[4] flex max-w-full gap-1 overflow-x-auto p-[5px]"
   data-slot="suggestion-menu-content"
   role="group"
   aria-label="Подходящие стикеры"
   onKeyDown={event => {
    if (event.key === 'Escape') setDismissed(draft);
   }}
  >
   {matches.map(({sticker, replaceDraft}) => (
    <TooltipLabel content={sticker.name} key={sticker.id}>
     <button
      type="button"
      aria-label={sticker.name}
      disabled={busy || pending}
      onClick={() => void select(sticker.id, replaceDraft)}
     >
      <StickerImage sticker={sticker} />
     </button>
    </TooltipLabel>
   ))}
  </div>
 );
}
