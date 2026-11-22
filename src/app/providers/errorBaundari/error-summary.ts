/** Текст для человека и текст для буфера обмена: без этого ошибку нечем показать и некуда скопировать. */

export function errorTitle(error: Error): string {
 switch (error.name) {
  case 'ChunkLoadError':
  case 'TypeError':
   return 'Интерфейс не смог загрузить часть данных';
  case 'RangeError':
   return 'Интерфейс вышел за допустимые границы';
  default:
   return 'Экран остановился из-за ошибки';
 }
}

export function errorSummary(error: Error): string {
 const message = (error.message || '').trim();
 return message ? `${error.name}: ${message}` : error.name || 'Неизвестная ошибка';
}

export function errorDetails(error: Error, componentStack?: string | null, extra?: Record<string, string>): string {
 const lines = [errorSummary(error)];
 const stack = (error.stack || '').trim();
 if (stack) lines.push('', stack);
 if (componentStack?.trim()) lines.push('', 'Дерево компонентов:', componentStack.trim());
 if (extra) for (const [key, value] of Object.entries(extra)) lines.push(`${key}: ${value}`);
 lines.push('', `Время: ${new Date().toISOString()}`);
 if (typeof window !== 'undefined') lines.push(`Адрес: ${window.location.href}`);
 return lines.join('\n');
}
