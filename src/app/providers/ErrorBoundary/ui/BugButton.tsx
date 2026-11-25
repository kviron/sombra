import {Button} from '@/shared/ui/button';
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
  <Button type="button" onClick={() => setCrash(true)}>
   Уронить интерфейс
  </Button>
 );
}
