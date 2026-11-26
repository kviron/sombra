// Хранилище одной карточки сообщения: реакции, копирование и открытые окна.
// Модель создаётся на карточку: у каждого сообщения свои «занято» и окна.
import {createStore} from 'zustand/vanilla';
import {toast} from 'sonner';
import {dequal} from 'dequal/lite';
import type {ChatState, User} from '@/shared/types';
import {canGroup} from '@/entities/group';
import {messageService} from '@/entities/message';

export type MessageDialog = 'edit' | 'delete';

export type MessageRowState = Pick<
 ChatState,
 'me' | 'users' | 'stickers' | 'readReceiptsSupported' | 'stickerCatalogSupported'
> & {
 canDeleteAny: boolean;
 voiceChannels: {group: string; id: string; name: string}[];
};

function rowIdentity({online: _online, last_seen: _lastSeen, ...identity}: User) {
 return identity;
}

// Keep a single presentation snapshot per mounted transcript. Presence belongs to the member list.
export function createMessageRowSelector() {
 let previous: MessageRowState | undefined;
 return (state: ChatState, channelId?: string) => {
  const current = state.groups.find(group => group.channels.some(channel => channel.id === channelId));
  const next: MessageRowState = {
   me: rowIdentity(state.me),
   users: state.users.map(rowIdentity),
   canDeleteAny: !!current?.permissions && canGroup(current, state.me.id, 'messages.delete_any'),
   voiceChannels: state.groups.flatMap(group =>
    group.channels
     .filter(channel => channel.kind === 'voice')
     .map(channel => ({group: group.id, id: channel.id, name: channel.name}))
   ),
   stickers: state.stickers,
   readReceiptsSupported: state.readReceiptsSupported,
   stickerCatalogSupported: state.stickerCatalogSupported
  };
  if (previous && dequal(previous, next)) return previous;
  previous = next;
  return next;
 };
}

export type MessageItemState = {
 busy: boolean;
 dialog: MessageDialog | undefined;
 readersOpen: boolean;
};

const initialState: MessageItemState = {
 busy: false,
 dialog: undefined,
 readersOpen: false
};

export type ReactArgs = {
 message: string;
 emoji: string;
 refresh: () => Promise<unknown>;
 onError: (message: string) => void;
};

export type CopyArgs = {text: string; onError: (message: string) => void};

export function createMessageItemModel() {
 const store = createStore<MessageItemState>(() => initialState);

 const actions = {
  openEdit() {
   store.setState({dialog: 'edit'});
  },
  openDelete() {
   store.setState({dialog: 'delete'});
  },
  closeDialog() {
   store.setState({dialog: undefined});
  },
  openReaders() {
   store.setState({readersOpen: true});
  },
  closeReaders() {
   store.setState({readersOpen: false});
  },

  /** Реакция: сервер подтверждает её, снапшот обновляется, ошибка уходит странице. */
  async react({message, emoji, refresh, onError}: ReactArgs) {
   if (store.getState().busy) return;
   store.setState({busy: true});
   try {
    await messageService.react({message, emoji});
    await refresh();
   } catch (reason) {
    onError((reason as Error).message);
   } finally {
    store.setState({busy: false});
   }
  },

  /** Копирование текста: буфер обмена может быть недоступен, это не ошибка модели. */
  async copyText({text, onError}: CopyArgs) {
   try {
    await navigator.clipboard.writeText(text);
    toast.success('Текст скопирован');
   } catch {
    onError('Не удалось скопировать текст сообщения');
   }
  }
 };

 return {store, actions};
}

export type MessageItemStore = ReturnType<typeof createMessageItemModel>;
