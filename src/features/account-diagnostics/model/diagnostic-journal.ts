// Состояние журнала диагностики: чтение, очистка, копирование и скачивание.
import {createStore} from 'zustand/vanilla';
import {
 entryDetails,
 journalExportText,
 newestFirst,
 type DiagnosticEntry,
 type JournalPhase
} from './diagnostic-journal-rules';

export type DiagnosticJournalState = {
 phase: JournalPhase;
 entries: DiagnosticEntry[] | null;
 feedback: string;
};

const initialState: DiagnosticJournalState = {phase: 'loading', entries: null, feedback: ''};

export type LoadArgs = {read: () => Promise<DiagnosticEntry[]>; isAlive: () => boolean};
export type ClearArgs = LoadArgs & {clear: () => Promise<void>};
type AliveArgs = {isAlive: () => boolean};

/**
 * Хранилище создаётся на открытый журнал: отзыв «скопировано» и загруженные записи не
 * переходят в следующее открытие, а позднее чтение не перебивает новое.
 */
export function createDiagnosticJournalModel() {
 const store = createStore<DiagnosticJournalState>(() => initialState);
 let epoch = 0;

 async function loadEntries({read, isAlive}: LoadArgs) {
  const sequence = ++epoch;
  try {
   const entries = await read();
   if (isAlive() && sequence === epoch) store.setState({phase: 'ready', entries: newestFirst(entries)});
  } catch {
   if (isAlive() && sequence === epoch) store.setState(state => ({...state, phase: 'failed'}));
  }
 }

 const actions = {
  load(args: LoadArgs) {
   return loadEntries(args);
  },
  /** Повторное чтение: старые записи остаются на экране, пока не пришёл ответ. */
  refresh(args: LoadArgs) {
   epoch++;
   store.setState(state => ({...state, phase: 'loading'}));
   return loadEntries(args);
  },
  async copy({isAlive}: AliveArgs) {
   const {entries} = store.getState();
   if (!entries?.length) return;
   try {
    await navigator.clipboard.writeText(journalExportText(entries));
    if (isAlive()) store.setState({feedback: 'Журнал скопирован.'});
   } catch {
    if (isAlive()) store.setState({feedback: 'Не удалось скопировать журнал. Попробуйте скачать файл.'});
   }
  },
  async copyDetails(details: ReturnType<typeof entryDetails>, {isAlive}: AliveArgs) {
   try {
    await navigator.clipboard.writeText(JSON.stringify(details, null, 2));
    if (isAlive()) store.setState({feedback: 'Детали ошибки скопированы.'});
   } catch {
    if (isAlive()) store.setState({feedback: 'Не удалось скопировать детали ошибки.'});
   }
  },
  download() {
   const {entries} = store.getState();
   if (!entries?.length) return;
   const url = URL.createObjectURL(new Blob([journalExportText(entries)], {type: 'application/x-ndjson'}));
   const link = document.createElement('a');
   link.href = url;
   link.download = 'sombra-diagnostics.jsonl';
   document.body.append(link);
   link.click();
   link.remove();
   window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  /** Очистка подтверждается здесь же: после неё журнал перечитывается с сервера оболочки. */
  async clear({clear, ...args}: ClearArgs) {
   const {entries} = store.getState();
   if (!entries?.length) return;
   if (!window.confirm('Очистить журнал? Записи диагностики будут удалены без возможности восстановления.')) return;
   epoch++;
   store.setState({phase: 'loading', entries: null, feedback: ''});
   try {
    await clear();
    if (!args.isAlive()) return;
    store.setState({feedback: 'Журнал очищен.'});
    await loadEntries(args);
   } catch {
    if (args.isAlive())
     store.setState(state => ({
      ...state,
      phase: 'failed',
      feedback: 'Не удалось очистить журнал. Попробуйте ещё раз.'
     }));
   }
  }
 };

 return {store, actions};
}

export type DiagnosticJournalModel = ReturnType<typeof createDiagnosticJournalModel>;
