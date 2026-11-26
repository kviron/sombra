// Состояние аудиовложения: загрузка через общий кэш, воспроизведение и скачивание.
import {createStore} from 'zustand/vanilla';
import {downloadAttachment} from './attachment-preview';

export type AttachmentAudioState = {
 url: string | undefined;
 identity: string;
 error: string;
 failed: boolean;
 playing: boolean;
 visible: boolean;
 inViewport: boolean;
 busy: boolean;
 retry: number;
};

const initialState: AttachmentAudioState = {
 url: undefined,
 identity: '',
 error: '',
 failed: false,
 playing: false,
 visible: false,
 inViewport: false,
 busy: false,
 retry: 0
};

export function createAttachmentAudioModel() {
 const store = createStore<AttachmentAudioState>(() => initialState);

 const actions = {
  setVisible(visible: boolean) {
   store.setState({visible});
  },
  setInViewport(inViewport: boolean) {
   store.setState({inViewport});
  },
  /** Новый файл или аккаунт: плеер начинается с чистого состояния. */
  startPreview(identity: string) {
   store.setState({url: undefined, error: '', failed: false, playing: false, identity});
  },
  setUrl(url: string | undefined) {
   store.setState({url});
  },
  setError(error: string) {
   store.setState({error});
  },
  setPlaying(playing: boolean) {
   store.setState({playing});
  },
  retryLoad() {
   store.setState(state => ({error: '', retry: state.retry + 1}));
  },
  playbackFailed() {
   store.setState({
    failed: true,
    playing: false,
    error: 'Не удалось воспроизвести файл. Скачайте его.'
   });
  },
  download({messageId, attachmentId, isAlive}: {messageId: string; attachmentId: string; isAlive: () => boolean}) {
   if (store.getState().busy) return;
   void downloadAttachment({
    messageId,
    attachmentId,
    isAlive,
    onBusy: busy => store.setState({busy}),
    onError: error => store.setState({error})
   });
  }
 };

 return {store, actions};
}
