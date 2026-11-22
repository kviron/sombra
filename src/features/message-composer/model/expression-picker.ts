// Хранилище одной панели эмодзи и стикеров: вкладка, поиск, набор и отправка.
// Модель создаётся на панель: поле ввода пересоздаёт её при смене переписки.
import {createStore} from 'zustand/vanilla';
import type {ExpressionPanel, StickerScope} from './expression-picker-rules';

export type ExpressionPickerState = {
 panel: ExpressionPanel | undefined;
 busy: boolean;
 category: string;
 query: string;
 scope: StickerScope;
 pack: string;
};

const initialState: ExpressionPickerState = {
 panel: undefined,
 busy: false,
 category: 'people',
 query: '',
 scope: 'personal',
 pack: ''
};

export type SendStickerArgs = {
 id: string;
 send: (id: string) => Promise<void>;
 onError: (message: string) => void;
};

export function createExpressionPickerModel() {
 const store = createStore<ExpressionPickerState>(() => initialState);

 const actions = {
  /** Кнопка панели открывает свою вкладку и закрывает её повторным нажатием. */
  togglePanel(panel: ExpressionPanel) {
   store.setState(current => ({panel: current.panel === panel ? undefined : panel}));
  },
  showPanel(panel: ExpressionPanel) {
   store.setState({panel});
  },
  closePanel() {
   store.setState({panel: undefined});
  },
  /** Категория сбрасывает поиск: иначе список выглядит неполным. */
  chooseCategory(category: string) {
   store.setState({category, query: ''});
  },
  setQuery(query: string) {
   store.setState({query});
  },
  chooseScope(scope: StickerScope) {
   store.setState({scope, pack: ''});
  },
  setPack(pack: string) {
   store.setState({pack});
  },

  /** Стикер уходит сразу, панель закрывается только после успеха. */
  async sendSticker({id, send, onError}: SendStickerArgs) {
   store.setState({busy: true});
   try {
    await send(id);
    store.setState({panel: undefined});
   } catch (reason) {
    onError((reason as Error).message);
   } finally {
    store.setState({busy: false});
   }
  }
 };

 return {store, actions};
}

export type ExpressionPickerStore = ReturnType<typeof createExpressionPickerModel>;
