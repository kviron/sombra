type DownloadEvent =
 | {event: 'Started'; data: {contentLength?: number}}
 | {event: 'Progress'; data: {chunkLength: number}}
 | {event: 'Finished'};
type Update = {
 version: string;
 body?: string;
 download: (cb: (event: DownloadEvent) => void) => Promise<void>;
 install: () => Promise<void>;
 close: () => Promise<void>;
};
export type UpdateState = {
 phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'restart' | 'error';
 version?: string;
 notes?: string;
 percent?: number;
 message?: string;
};
export function createUpdater(adapter: {check: () => Promise<Update | null>; relaunch: () => Promise<void>}) {
 let state: UpdateState = {phase: 'idle'},
  pending: Update | null = null;
 const listeners = new Set<() => void>();
 const set = (next: UpdateState) => {
  state = next;
  listeners.forEach(fn => fn());
 };
 return {
  snapshot: () => state,
  subscribe: (fn: () => void) => {
   listeners.add(fn);
   return () => {
    listeners.delete(fn);
   };
  },
  async check() {
   if (['checking', 'available', 'downloading', 'ready', 'installing', 'restart'].includes(state.phase)) return;
   set({phase: 'checking'});
   try {
    if (pending) {
     await pending.close();
     pending = null;
    }
    pending = await adapter.check();
    set(pending ? {phase: 'available', version: pending.version, notes: pending.body} : {phase: 'current'});
   } catch {
    set({phase: 'error', message: 'Не удалось проверить обновления. Проверьте подключение и повторите попытку.'});
   }
  },
  async download() {
   if (state.phase !== 'available' || !pending) return;
   set({...state, phase: 'downloading', percent: undefined});
   let total: number | undefined,
    received = 0;
   try {
    await pending.download(event => {
     if (event.event === 'Started') {
      total = event.data.contentLength;
      received = 0;
     }
     if (event.event === 'Progress') {
      received += event.data.chunkLength;
      const percent = total ? Math.min(100, Math.floor((received / total) * 100)) : undefined;
      if (percent !== state.percent) set({...state, percent});
     }
    });
    set({...state, phase: 'ready', percent: 100});
   } catch {
    set({
     ...state,
     phase: 'error',
     message: 'Не удалось загрузить или проверить обновление. Текущая версия продолжает работать.'
    });
   }
  },
  async install() {
   if (state.phase !== 'ready' || !pending) return;
   set({...state, phase: 'installing'});
   try {
    await pending.install();
   } catch {
    set({...state, phase: 'ready', message: 'Не удалось установить обновление. Попробуйте ещё раз.'});
    return;
   }
   set({...state, phase: 'restart'});
   await this.restart();
  },
  async restart() {
   if (state.phase !== 'restart') return;
   try {
    await adapter.relaunch();
   } catch {
    set({...state, message: 'Обновление установлено. Закройте Sombra и откройте снова.'});
   }
  }
 };
}
