import {Input} from '@/shared/ui/input';
import { authenticate } from '@/shared/api/backend';
import { useState, type FormEvent } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Button, SombraLogo } from "@/shared/ui";

export function LoginPage() {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try { await authenticate('login', {email: data.get('email'), password: data.get('password'), remember_me: data.get('remember_me') === 'on'}); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return (
    <main className="flex min-h-0 flex-1 overflow-y-auto px-5 py-10">
      <section aria-labelledby="login-title" className="m-auto w-full max-w-[440px] rounded-xl border border-border bg-background p-6 sm:p-9">
        <div className="mb-7 flex items-center justify-center gap-2.5">
          <SombraLogo className="sombra-logo--auth" />
        </div>
        <h1 id="login-title" className="text-center text-2xl font-semibold tracking-tight">С возвращением!</h1>
        <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">Войдите в свою учётную запись.</p>
        <form className="mt-8 space-y-5" onSubmit={submit} onChange={() => setError("")}>
          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm font-medium">Электронная почта</label>
            <Input id="email" name="email" type="email" autoComplete="username" placeholder="you@example.com" required maxLength={254} className="login-input" />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="block text-sm font-medium">Пароль</label>
            <div className="relative">
              <Input id="password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" placeholder="Введите пароль" required className="login-input login-password" />
              <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Скрыть пароль" : "Показать пароль"} aria-pressed={visible} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input type="checkbox" name="remember_me" aria-describedby="remember-hint" className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-ring" />
              Оставаться в системе
            </label>
            <p id="remember-hint" className="pl-[26px] text-xs text-muted-foreground">Сохранять вход на этом устройстве в течение года.</p>
          </div>
          {error && <p role="alert" className="text-sm leading-5 text-destructive">{error}</p>}
          <Button disabled={busy} type="submit" className="h-11 w-full text-sm">Войти</Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Нет аккаунта?{" "}
          <a href="#register" className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Создать аккаунт</a>
        </p>
      </section>
    </main>
  );
}

