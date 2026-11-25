import {TooltipLabel} from '@/shared/ui/tooltip';
import '@/shared/ui/menu-material.css';
import {Input} from '@/shared/ui/input';
import {Smile, Sticker as StickerIcon, X} from 'lucide-react';
import {useRef} from 'react';
import {Popover} from 'radix-ui';
import type {ChatState, Group} from '@/shared/types';
import {ComposerIconButton} from '@/shared/ui/elements-composer';
import {OptionsSelect} from '@/shared/ui/select';
import {StickerImage} from '@/entities/sticker';
import {useExpressionPicker} from '../model/use-expression-picker';

/**
 * Панель только показывает: вкладка, поиск и набор приходят из модели среза.
 * Состояние не переживает смену переписки — компонент пересоздаётся по ключу канала.
 */
export function ExpressionPicker({
 state,
 onError,
 onEmoji,
 onSticker,
 disabled,
 group,
 onManage
}: {
 onEmoji: (emoji: string) => void;
 onSticker: (id: string) => Promise<void>;
 disabled: boolean;
 group?: Group;
 onManage: (scope: 'personal' | 'group') => void;
} & {state: ChatState; refresh: () => Promise<unknown>; onError: (message: string) => void}) {
 const model = useExpressionPicker({state, group, onEmoji, onSticker, onError, onManage});
 const {panel, busy, category, query, scope, activePack, filtered, actions} = model;
 const controls = useRef<HTMLDivElement>(null);
 const composerAnchor = useRef<HTMLElement>(null);

 return (
  <Popover.Root
   open={!!panel}
   onOpenChange={open => {
    if (!open) actions.close();
   }}
  >
   <Popover.Anchor virtualRef={composerAnchor} />
   <div
    ref={node => {
     controls.current = node;
     composerAnchor.current = node?.closest<HTMLElement>('[data-slot="composer"]') ?? node;
    }}
    className="expression-control flex items-center gap-1.5"
   >
    <TooltipLabel content="Эмодзи">
     <ComposerIconButton
      aria-label="Эмодзи"
      disabled={disabled}
      aria-expanded={panel === 'emoji'}
      onClick={() => actions.toggle('emoji')}
     >
      <Smile size={16} />
     </ComposerIconButton>
    </TooltipLabel>
    <TooltipLabel content="Стикеры">
     <ComposerIconButton
      aria-label="Стикеры"
      disabled={disabled}
      aria-expanded={panel === 'stickers'}
      onClick={() => actions.toggle('stickers')}
     >
      <StickerIcon size={16} />
     </ComposerIconButton>
    </TooltipLabel>
   </div>
   {panel && (
    <Popover.Portal>
     <Popover.Content
      side="top"
      align="start"
      sideOffset={12}
      collisionPadding={12}
      className="expression-panel sombra-menu-surface sombra-picker-material z-[150] max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-24px)] overflow-y-auto p-3 shadow-lg"
      data-slot="expression-menu-content"
      aria-label="Эмодзи и стикеры"
      onInteractOutside={event => {
       if (event.target instanceof Node && controls.current?.contains(event.target)) event.preventDefault();
      }}
     >
      <header>
       <nav className="expression-tabs flex gap-1" aria-label="Тип вложения">
        <button type="button" aria-pressed={panel === 'emoji'} onClick={() => actions.show('emoji')}>
         Эмодзи
        </button>
        <button type="button" aria-pressed={panel === 'stickers'} onClick={() => actions.show('stickers')}>
         Стикеры
        </button>
       </nav>
       <TooltipLabel content="Закрыть панель">
        <button type="button" aria-label="Закрыть панель" onClick={actions.close}>
         <X size={16} />
        </button>
       </TooltipLabel>
      </header>
      {panel === 'emoji' ? (
       <>
        <div className="expression-filters mb-2 grid grid-cols-[minmax(0,1fr)_auto] gap-[6px]">
         <Input
          aria-label="Поиск эмодзи"
          placeholder="Поиск эмодзи"
          value={query}
          onKeyDown={event => {
           if (event.key === 'Enter') event.preventDefault();
          }}
          onChange={event => actions.setQuery(event.target.value)}
         />
         <OptionsSelect
          label="Категория эмодзи"
          value={category}
          onValueChange={actions.chooseCategory}
          options={model.categoryOptions}
         />
        </div>
        <div className="emoji-grid grid" key={category}>
         {model.emojiItems.map(item => (
          <TooltipLabel content={item.name} key={item.id}>
           <button type="button" aria-label={item.name} onClick={() => actions.chooseEmoji(item.emoji)}>
            {item.emoji}
           </button>
          </TooltipLabel>
         ))}
        </div>
        {!model.emojiItems.length && <p>Эмодзи не найдены.</p>}
       </>
      ) : (
       <>
        {group && (
         <nav className="expression-tabs sticker-scopes flex gap-1" aria-label="Библиотека стикеров">
          <button type="button" aria-pressed={scope === 'personal'} onClick={() => actions.chooseScope('personal')}>
           Мои стикеры
          </button>
          <button type="button" aria-pressed={scope === 'group'} onClick={() => actions.chooseScope('group')}>
           Стикеры группы
          </button>
         </nav>
        )}
        {model.packsCount > 1 && (
         <OptionsSelect
          label="Набор стикеров"
          value={activePack}
          onValueChange={actions.setPack}
          options={model.packOptions}
         />
        )}
        {filtered.length ? (
         <div className="sticker-grid grid max-h-[220px] grid-cols-[repeat(3,1fr)] gap-2 overflow-auto">
          {filtered.map(sticker => (
           <TooltipLabel content={sticker.name} key={sticker.id}>
            <button
             type="button"
             disabled={disabled || busy}
             aria-label={sticker.name}
             onClick={() => actions.send(sticker.id)}
            >
             <StickerImage sticker={sticker} />
            </button>
           </TooltipLabel>
          ))}
         </div>
        ) : (
         <p>Пока нет стикеров.</p>
        )}
        {model.manageVisible && (
         <button type="button" className="manage-stickers" onClick={actions.manage}>
          Управлять стикерами
         </button>
        )}
       </>
      )}
     </Popover.Content>
    </Popover.Portal>
   )}
  </Popover.Root>
 );
}
