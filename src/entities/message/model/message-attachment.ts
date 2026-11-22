// Состояние одного вложения: ленивая загрузка картинки, предпросмотр, просмотр, копирование и скачивание.
import {toast} from 'sonner';
import {createStore} from 'zustand/vanilla';
import {copyImageToClipboard, previewImageBlob} from './attachment-clipboard';
import {downloadAttachment} from './attachment-preview';
import {attachmentCopyError, canCopyAttachment} from './message-attachment-rules';

export type MessageAttachmentState = {
 visible: boolean;
 inViewport: boolean;
 preview: string | undefined;
 previewIdentity: string;
 error: string;
 busy: boolean;
 copying: boolean;
 copyError: string;
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
 copying: false,
 copyError: '',
 open: false,
 retry: 0
};

export type AttachmentDownloadArgs = {messageId: string; available: boolean; isAlive: () => boolean};
export type AttachmentCopyArgs = {
 preview: string | undefined;
 available: boolean;
 mime: string;
 isAlive: () => boolean;
};

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
   store.setState({preview: undefined, error: '', copyError: '', previewIdentity: identity});
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
   store.setState(state => ({error: '', copyError: '', retry: state.retry + 1}));
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
  },
  /**
   * Копирование: blob готового предпросмотра уходит в буфер, сеть не участвует.
   * Отказ буфера возвращается строкой и показывается рядом с картинкой, не трогая сам предпросмотр.
   */
  async copy({preview, available, mime, isAlive}: AttachmentCopyArgs): Promise<string | undefined> {
   if (!preview || store.getState().copying || !canCopyAttachment({available, mime, loaded: true})) return;
   store.setState({copying: true, copyError: ''});
   try {
    await copyImageToClipboard(await previewImageBlob(preview));
    if (isAlive()) toast.success('Изображение скопировано');
    return;
   } catch {
    if (isAlive()) store.setState({copyError: attachmentCopyError});
    return attachmentCopyError;
   } finally {
    if (isAlive()) store.setState({copying: false});
   }
  }
 };

 return {store, actions};
}
