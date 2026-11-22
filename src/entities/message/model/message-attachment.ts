// Состояние одного вложения: ленивая загрузка картинки, предпросмотр, просмотр и скачивание.
import {createStore} from 'zustand/vanilla';
import {downloadAttachment} from './attachment-preview';

export type MessageAttachmentState = {
 visible: boolean;
 inViewport: boolean;
 preview: string | undefined;
 previewIdentity: string;
 error: string;
 busy: boolean;
 open: boolean;
 retry: number;
};

const initialState: MessageAttachmentState = {
 visible: false,
 inViewport: false,
 preview: undefined,
 previewIdentity: '',
 error: '',
 busy: false,
 open: false,
 retry: 0
};

export type AttachmentDownloadArgs = {messageId: string; available: boolean; isAlive: () => boolean};

export function createMessageAttachmentModel() {
 const store = createStore<MessageAttachmentState>(() => initialState);

 const actions = {
  setVisible(visible: boolean) {
   store.setState({visible});
  },
  setInViewport(inViewport: boolean) {
   store.setState({inViewport});
  },
  /** Новый файл или аккаунт: старый предпросмотр и ошибка больше не относятся к вложению. */
  startPreview(identity: string) {
   store.setState({preview: undefined, error: '', previewIdentity: identity});
  },
  setPreview(preview: string | undefined, reason?: unknown) {
   if (!reason) store.setState({preview});
   else
    store.setState({
     preview,
     error: reason instanceof Error ? reason.message : 'Не удалось загрузить вложение.'
    });
  },
  setError(error: string) {
   store.setState({error});
  },
  setOpen(open: boolean) {
   store.setState({open});
  },
  retryLoad() {
   store.setState(state => ({error: '', retry: state.retry + 1}));
  },
  /** Скачивание не запускается повторно, пока идёт предыдущее, и для недоступного файла. */
  download({messageId, available, isAlive}: AttachmentDownloadArgs) {
   if (store.getState().busy || !available) return;
   void downloadAttachment({
    messageId,
    isAlive,
    onBusy: busy => store.setState({busy}),
    onError: error => store.setState({error})
   });
  }
 };

 return {store, actions};
}
