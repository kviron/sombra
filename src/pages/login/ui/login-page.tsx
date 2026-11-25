import {Input} from '@/shared/ui/input';
import {authService} from '@/entities/user';
import {useState, type FormEvent} from 'react';
import {EyeIcon, EyeOffIcon} from 'lucide-react';
import {Checkbox} from '@/shared/ui/checkbox';
import {Button} from '@/shared/ui';
import {Label} from '@/shared/ui/label';

export function LoginPage() {
 const [visible, setVisible] = useState(false);
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  setBusy(true);
  setError('');
  try {
   await authService.login({
    email: data.get('email'),
    password: data.get('password'),
    remember_me: data.get('remember_me') === 'on'
   });
  } catch (error) {
   setError((error as Error).message);
  } finally {
   setBusy(false);
  }
 }
 return (
  <main className="auth-form-page relative flex min-h-0 flex-1 overflow-y-auto px-6 py-10">
   <section aria-labelledby="login-title" className="m-auto w-full max-w-[440px]">
    <div className="border-border mb-6 border-b pb-4">
     <strong className="text-primary">Sombra</strong>
    </div>
    <h1 id="login-title" className="text-[28px] leading-tight font-bold">
     Вход в аккаунт
    </h1>
    <form className="mt-6 grid gap-4" onSubmit={submit} onChange={() => setError('')}>
     <div className="grid gap-1.5">
      <Label htmlFor="email">Электронная почта</Label>
      <Input
       id="email"
       name="email"
       type="email"
       autoComplete="username"
       placeholder="you@example.com"
       required
       maxLength={254}
       className="h-11"
      />
     </div>
     <div className="grid gap-1.5">
      <Label htmlFor="password">Пароль</Label>
      <div className="relative">
       <Input
        id="password"
        name="password"
        type={visible ? 'text' : 'password'}
        autoComplete="current-password"
        placeholder="Введите пароль"
        required
        className="h-11 pr-12"
       />
       <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setVisible(!visible)}
        aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-pressed={visible}
        className="absolute top-1/2 right-1 -translate-y-1/2"
       >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
       </Button>
      </div>
     </div>
     <div className="space-y-1">
      <div className="flex min-h-7 items-center gap-2.5 text-sm">
       <Checkbox id="remember-me" name="remember_me" value="on" aria-describedby="remember-hint" />
       <Label htmlFor="remember-me" className="cursor-pointer font-normal">
        Оставаться в системе
       </Label>
      </div>
      <p id="remember-hint" className="text-muted-foreground pl-[26px] text-xs">
       Сохранять вход на этом устройстве в течение года.
      </p>
     </div>
     {error && (
      <p role="alert" className="text-destructive text-sm leading-5">
       {error}
      </p>
     )}
     <Button disabled={busy} type="submit" className="h-11 w-full text-sm">
      Войти
     </Button>
    </form>
    <p className="text-muted-foreground mt-4 text-sm">
     Нет аккаунта?{' '}
     <a
      href="#register"
      className="text-foreground focus-visible:outline-ring font-medium underline-offset-4 hover:underline focus-visible:outline-2"
     >
      Создать аккаунт
     </a>
    </p>
   </section>
  </main>
 );
}
