import {useMemo, useState} from 'react';
import {useStore} from 'zustand';
import emojiData from '@emoji-mart/data/sets/15/native.json';
import type {ChatState, Group} from '@/shared/types';
import {canGroup} from '@/entities/group';
import {personalSticker, stickerPackKey} from '@/entities/sticker';
import {
 canManageStickers,
 emojiCategoryOptions,
 resolvePack,
 stickerPackOptions,
 visibleEmojiIds,
 visibleStickers,
 type EmojiEntry,
 type StickerScope
} from './expression-picker-rules';
import {createExpressionPickerModel} from './expression-picker';

const emojiById = emojiData.emojis as Record<string, EmojiEntry>;

type Options = {
 state: ChatState;
 group?: Group;
 onEmoji: (emoji: string) => void;
 onSticker: (id: string) => Promise<void>;
 onError: (message: string) => void;
 onManage: (scope: StickerScope) => void;
};

/**
 * Единственное место, где живёт логика панели: вкладка, поиск, набор и отправка стикера.
 * Компонент получает готовые списки и колбэки.
 */
export function useExpressionPicker({state, group, onEmoji, onSticker, onError, onManage}: Options) {
 const [model] = useState(createExpressionPickerModel);
 const {panel, busy, category, query, scope, pack} = useStore(model.store);

 const library = useMemo(
  () =>
   state.stickers.filter(
    sticker =>
     !sticker.archived &&
     (scope === 'group' ? !!group && sticker.group === group.id : personalSticker(sticker, state.me.id))
   ),
  [state.stickers, state.me.id, scope, group]
 );
 const packs = useMemo(() => new Map(library.map(sticker => [stickerPackKey(sticker), sticker.pack || ''])), [library]);
 const activePack = resolvePack(packs, pack);
 const packOptions = stickerPackOptions(packs);
 const filtered = useMemo(() => visibleStickers(library, activePack, stickerPackKey), [library, activePack]);
 const emojiIds = useMemo(
  () => visibleEmojiIds({emojis: emojiById, categories: emojiData.categories, category, query}),
  [category, query]
 );
 /** Готовая сетка эмодзи: компоненту не нужен доступ к словарю. */
 const emojiItems = useMemo(
  () =>
   emojiIds.flatMap(id => {
    const item = emojiById[id],
     emoji = item?.skins[0]?.native;
    return emoji ? [{id, emoji, name: item.name}] : [];
   }),
  [emojiIds]
 );
 const categoryOptions = useMemo(() => emojiCategoryOptions(emojiData.categories), []);
 const manageVisible = canManageStickers(scope, canGroup(group, state.me.id, 'stickers.manage'));

 return {
  panel,
  busy,
  category,
  query,
  scope,
  activePack,
  packsCount: packs.size,
  packOptions,
  filtered,
  emojiItems,
  categoryOptions,
  manageVisible,
  actions: {
   toggle: model.actions.togglePanel,
   show: model.actions.showPanel,
   close: model.actions.closePanel,
   chooseCategory: model.actions.chooseCategory,
   setQuery: model.actions.setQuery,
   chooseScope: model.actions.chooseScope,
   setPack: model.actions.setPack,
   chooseEmoji(emoji: string) {
    onEmoji(emoji);
    model.actions.closePanel();
   },
   send(id: string) {
    void model.actions.sendSticker({id, send: onSticker, onError});
   },
   manage() {
    if (!manageVisible) return;
    model.actions.closePanel();
    onManage(scope);
   }
  }
 };
}

export type ExpressionPickerModel = ReturnType<typeof useExpressionPicker>;
