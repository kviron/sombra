import {tauri} from '../tauri';
import type {DiagnosticEntryRecord} from '../tauri/commands';

/** Журнал диагностики живёт в Rust-оболочке, поэтому у него нет серверного API — только сервис. */
export const diagnosticsService = {
 available: () => tauri.isTauri(),
 list: <T = DiagnosticEntryRecord>() => tauri.commands.diagnostics.read<T>(),
 clear: () => tauri.commands.diagnostics.clear()
};
