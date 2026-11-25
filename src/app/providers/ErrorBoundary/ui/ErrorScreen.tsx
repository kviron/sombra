import {useEffect, useRef, useState} from 'react';
import {Button} from '@/shared/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/shared/ui/card';
import {Separator} from '@/shared/ui/separator';
import {errorDetails, errorSummary, errorTitle} from '../lib/error-summary';

type Props = {
 error: Error;
 componentStack: string | null;
 onRetry: () => void;
 onReload: () => void;
};

export function ErrorScreen({error, componentStack, onRetry, onReload}: Props) {
 const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
 const primary = useRef<HTMLButtonElement | null>(null);

 // Упавший элемент размонтирован вместе с фокусом: возвращаем его на главное действие.
 useEffect(() => {
  primary.current?.focus();
 }, []);

 async function copy() {
  try {
   await navigator.clipboard.writeText(errorDetails(error, componentStack));
   setCopied('done');
  } catch {
   setCopied('failed');
  }
  window.setTimeout(() => setCopied('idle'), 2500);
 }

 return (
  <main
   className="bg-background text-foreground fixed inset-0 z-[9000] grid place-items-center overflow-auto p-6"
   role="alert"
   aria-live="assertive"
  >
   <Card className="w-full max-w-2xl">
    <CardHeader>
     <CardTitle>
      <h1>{errorTitle(error)}</h1>
     </CardTitle>
     <CardDescription>
      Переписка, звонки и настройки не пострадали: данные остались на сервере и в локальном хранилище. Продолжить можно
      с этого же места.
     </CardDescription>
    </CardHeader>
    <CardContent className="grid gap-4">
     <pre className="bg-muted max-h-44 overflow-auto rounded-md p-3 font-mono text-xs wrap-anywhere whitespace-pre-wrap">
      {errorSummary(error)}
     </pre>
     <div className="flex flex-wrap gap-2">
      <Button type="button" ref={primary} onClick={onRetry}>
       Вернуться в приложение
      </Button>
      <Button type="button" variant="secondary" onClick={onReload}>
       Перезагрузить
      </Button>
      <Button type="button" variant="ghost" onClick={() => void copy()}>
       {copied === 'done' ? 'Скопировано' : copied === 'failed' ? 'Не удалось скопировать' : 'Скопировать текст ошибки'}
      </Button>
     </div>
     <Separator />
     <details>
      <summary className="text-muted-foreground cursor-pointer">Подробности для отчёта об ошибке</summary>
      <pre className="text-muted-foreground mt-2 max-h-56 overflow-auto font-mono text-xs wrap-anywhere whitespace-pre-wrap">
       {errorDetails(error, componentStack)}
      </pre>
     </details>
    </CardContent>
   </Card>
  </main>
 );
}
