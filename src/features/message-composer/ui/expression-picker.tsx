import {Smile, Sticker as StickerIcon, X} from 'lucide-react';
import type {ChatState, Group} from '@/shared/types';
import {ComposerIconButton} from '@/shared/ui/elements-composer';
import {Select} from '@/shared/ui/select';
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

 return (
  <div className="expression-control relative flex items-center gap-1.5">
   <ComposerIconButton
    title="Эмодзи"
    disabled={disabled}
    aria-expanded={panel === 'emoji'}
    onClick={() => actions.toggle('emoji')}
   >
    <Smile size={16} />
   </ComposerIconButton>
   <ComposerIconButton
    title="Стикеры"
    disabled={disabled}
    aria-expanded={panel === 'stickers'}
    onClick={() => actions.toggle('stickers')}
   >
    <StickerIcon size={16} />
   </ComposerIconButton>
   {panel && (
    <section
     className="expression-panel sombra-menu-surface absolute right-0 bottom-[42px] z-[5] w-[344px] max-w-[calc(100vw_-_40px)] p-3"
     data-slot="expression-menu-content"
     aria-label="Эмодзи и стикеры"
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
      <button type="button" title="Закрыть панель" onClick={actions.close}>
       <X size={16} />
      </button>
     </header>
     {panel === 'emoji' ? (
      <>
       <div className="expression-filters mb-2 grid grid-cols-[minmax(0,1fr)_auto] gap-[6px]">
        <input
         aria-label="Поиск эмодзи"
         placeholder="Поиск эмодзи"
         value={query}
         onKeyDown={event => {
          if (event.key === 'Enter') event.preventDefault();
         }}
         onChange={event => actions.setQuery(event.target.value)}
        />
        <Select
         label="Категория эмодзи"
         value={category}
         onValueChange={actions.chooseCategory}
         options={model.categoryOptions}
        />
       </div>
       <div className="emoji-grid grid grid-cols-[repeat(4,1fr)] gap-2" key={category}>
        {model.emojiItems.map(item => (
         <button key={item.id} type="button" title={item.name} onClick={() => actions.chooseEmoji(item.emoji)}>
          {item.emoji}
         </button>
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
        <Select label="Набор стикеров" value={activePack} onValueChange={actions.setPack} options={model.packOptions} />
       )}
       {filtered.length ? (
        <div className="sticker-grid grid max-h-[220px] grid-cols-[repeat(3,1fr)] gap-2 overflow-auto">
         {filtered.map(sticker => (
          <button
           type="button"
           key={sticker.id}
           disabled={disabled || busy}
           title={sticker.name}
           onClick={() => actions.send(sticker.id)}
          >
           <StickerImage sticker={sticker} />
          </button>
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
    </section>
   )}
  </div>
 );
}
