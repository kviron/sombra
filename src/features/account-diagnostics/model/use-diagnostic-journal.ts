import {useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import {diagnosticsService} from '@/shared/api';
import {createDiagnosticJournalModel} from './diagnostic-journal';
import {
 categoryLabel,
 entryDetails,
 entryLabel,
 journalClock,
 journalFullDate,
 type DiagnosticEntry
} from './diagnostic-journal-rules';

const readEntries = () => diagnosticsService.list<DiagnosticEntry>();
const clearEntries = () => diagnosticsService.clear();

type Options = {
 read?: () => Promise<DiagnosticEntry[]>;
 clear?: () => Promise<void>;
 available?: boolean;
};

/**
 * Единственное место, где живёт логика журнала диагностики: чтение, очистка, копирование
 * и скачивание. Компонент получает готовые данные и колбэки.
 */
export function useDiagnosticJournal({
 read = readEntries,
 clear = clearEntries,
 available = diagnosticsService.available()
}: Options = {}) {
 const [model] = useState(() => createDiagnosticJournalModel());
 const {phase, entries, feedback} = useStore(model.store);
 const alive = useRef(true);

 useEffect(() => {
  alive.current = true;
  return () => {
   alive.current = false;
  };
 }, []);

 useEffect(() => {
  if (!available) return;
  void model.actions.load({read, isAlive: () => alive.current});
 }, [model, available, read]);

 const refresh = () => {
  if (!available) return;
  void model.actions.refresh({read, isAlive: () => alive.current});
 };

 return {
  phase,
  entries,
  feedback,
  available,
  loading: available && phase === 'loading',
  refresh,
  copy: () => void model.actions.copy({isAlive: () => alive.current}),
  copyDetails: (details: ReturnType<typeof entryDetails>) =>
   void model.actions.copyDetails(details, {isAlive: () => alive.current}),
  download: model.actions.download,
  clearJournal: () => void model.actions.clear({clear, read, isAlive: () => alive.current}),
  label: entryLabel,
  category: categoryLabel,
  details: entryDetails,
  clock: journalClock,
  fullDate: journalFullDate
 };
}

export type DiagnosticJournalViewModel = ReturnType<typeof useDiagnosticJournal>;
