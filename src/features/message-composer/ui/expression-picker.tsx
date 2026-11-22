import {useState} from 'react';
import {Smile, Sticker as StickerIcon, X} from 'lucide-react';
import emojiData from '@emoji-mart/data/sets/15/native.json';
import type {ChatState, Group} from '@/shared/types';
import {ComposerIconButton} from '@/shared/ui/elements-composer';
import {Select} from '@/shared/ui/select';
import {canGroup} from '@/entities/group';
import {StickerImage, personalSticker, stickerPackKey} from '@/entities/sticker';

const categories: Record<string, string> = {
 people: 'Люди',
 nature: 'Природа',
 foods: 'Еда',
 activity: 'Занятия',
 places: 'Места',
 objects: 'Предметы',
 symbols: 'Символы',
 flags: 'Флаги'
};
const emojiById = emojiData.emojis as Record<string, {name: string; keywords?: string[]; skins: {native: string}[]}>;
type Panel = 'emoji' | 'stickers';
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
 const [panel, setPanel] = useState<Panel>();
 const [busy, setBusy] = useState(false),
  [category, setCategory] = useState('people'),
  [query, setQuery] = useState('');
 const [scope, setScope] = useState<'personal' | 'group'>('personal'),
  [pack, setPack] = useState('');
 const library = state.stickers.filter(
  sticker =>
   !sticker.archived &&
   (scope === 'group' ? !!group && sticker.group === group.id : personalSticker(sticker, state.me.id))
 );
 const packs = new Map(library.map(sticker => [stickerPackKey(sticker), sticker.pack || '']));
 const activePack = packs.has(pack) ? pack : '';
 const filtered = library.filter(sticker => !activePack || stickerPackKey(sticker) === activePack);
 const search = query.trim().toLowerCase();
 const emojiIds = search
  ? Object.keys(emojiById).filter(id => {
     const item = emojiById[id];
     return [item.name, id, ...(item.keywords || []), item.skins[0]?.native].some(value =>
      value?.toLowerCase().includes(search)
     );
    })
  : emojiData.categories.find(item => item.id === category)?.emojis || [];
 function toggle(next: Panel) {
  setPanel(panel === next ? undefined : next);
 }
 async function sendSticker(id: string) {
  setBusy(true);
  try {
   await onSticker(id);
   setPanel(undefined);
  } catch (e) {
   onError((e as Error).message);
  } finally {
   setBusy(false);
  }
 }
 return (
  <div className="expression-control flex items-center gap-1.5">
   <ComposerIconButton
    title="Эмодзи"
    disabled={disabled}
    aria-expanded={panel === 'emoji'}
    onClick={() => toggle('emoji')}
   >
    <Smile size={16} />
   </ComposerIconButton>
   <ComposerIconButton
    title="Стикеры"
    disabled={disabled}
    aria-expanded={panel === 'stickers'}
    onClick={() => toggle('stickers')}
   >
    <StickerIcon size={16} />
   </ComposerIconButton>
   {panel && (
    <section
     className="expression-panel sombra-menu-surface"
     data-slot="expression-menu-content"
     aria-label="Эмодзи и стикеры"
    >
     <header>
      <nav className="expression-tabs" aria-label="Тип вложения">
       <button type="button" aria-pressed={panel === 'emoji'} onClick={() => setPanel('emoji')}>
        Эмодзи
       </button>
       <button type="button" aria-pressed={panel === 'stickers'} onClick={() => setPanel('stickers')}>
        Стикеры
       </button>
      </nav>
      <button type="button" title="Закрыть панель" onClick={() => setPanel(undefined)}>
       <X size={16} />
      </button>
     </header>
     {panel === 'emoji' ? (
      <>
       <div className="expression-filters">
        <input
         aria-label="Поиск эмодзи"
         placeholder="Поиск эмодзи"
         value={query}
         onKeyDown={event => {
          if (event.key === 'Enter') event.preventDefault();
         }}
         onChange={event => setQuery(event.target.value)}
        />
        <Select
         label="Категория эмодзи"
         value={category}
         onValueChange={value => {
          setCategory(value);
          setQuery('');
         }}
         options={emojiData.categories.map(item => ({value: item.id, label: categories[item.id] || item.id}))}
        />
       </div>
       <div className="emoji-grid" key={category}>
        {emojiIds.map(id => {
         const item = emojiById[id],
          emoji = item?.skins[0]?.native;
         return (
          emoji && (
           <button
            key={id}
            type="button"
            title={item.name}
            onClick={() => {
             onEmoji(emoji);
             setPanel(undefined);
            }}
           >
            {emoji}
           </button>
          )
         );
        })}
       </div>
       {!emojiIds.length && <p>Эмодзи не найдены.</p>}
      </>
     ) : (
      <>
       {group && (
        <nav className="expression-tabs sticker-scopes" aria-label="Библиотека стикеров">
         <button
          type="button"
          aria-pressed={scope === 'personal'}
          onClick={() => {
           setScope('personal');
           setPack('');
          }}
         >
          Мои стикеры
         </button>
         <button
          type="button"
          aria-pressed={scope === 'group'}
          onClick={() => {
           setScope('group');
           setPack('');
          }}
         >
          Стикеры группы
         </button>
        </nav>
       )}
       {packs.size > 1 && (
        <Select
         label="Набор стикеров"
         value={activePack}
         onValueChange={setPack}
         options={[
          {value: '', label: 'Все наборы'},
          ...[...packs].filter(([key]) => key).map(([value, label]) => ({value, label}))
         ]}
        />
       )}
       {filtered.length ? (
        <div className="sticker-grid">
         {filtered.map(sticker => (
          <button
           type="button"
           key={sticker.id}
           disabled={disabled || busy}
           title={sticker.name}
           onClick={() => void sendSticker(sticker.id)}
          >
           <StickerImage sticker={sticker} />
          </button>
         ))}
        </div>
       ) : (
        <p>Пока нет стикеров.</p>
       )}
       {(scope === 'personal' || canGroup(group, state.me.id, 'stickers.manage')) && (
        <button
         type="button"
         className="manage-stickers"
         onClick={() => {
          setPanel(undefined);
          onManage(scope);
         }}
        >
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
