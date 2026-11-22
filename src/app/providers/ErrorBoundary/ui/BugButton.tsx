import {useState} from 'react';

/**
 * Кнопка для проверки границы ошибок на живом стенде. Включается только в разработке:
 * в собранном приложении не рендерится.
 */
export function BugButton() {
 const [crash, setCrash] = useState(false);
 if (!import.meta.env.DEV) return null;
 if (crash) throw new Error('Проверка границы ошибок: BugButton');
 return (
  <button
   type="button"
   className="border-border bg-card text-muted-foreground fixed right-3 bottom-3 z-[9999] rounded-[10px] border px-3 py-2 text-xs"
   onClick={() => setCrash(true)}
  >
   Уронить интерфейс
  </button>
 );
}
