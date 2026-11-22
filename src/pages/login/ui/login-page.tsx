import {Input} from '@/shared/ui/input';
import { authService } from '@/entities/user';
import { useState, type FormEvent } from "react";
import { CheckIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { Checkbox } from 'radix-ui';
import { Button } from "@/shared/ui";
import { Label } from "@/shared/ui/label";

export function LoginPage() {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try { await authService.login({email: data.get('email'), password: data.get('password'), remember_me: data.get('remember_me') === 'on'}); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return (
    <main className="auth-form-page relative flex min-h-0 flex-1 overflow-y-auto px-6 py-10">
      <section aria-labelledby="login-title" className="m-auto w-full max-w-[440px]">
        <div className="mb-6 border-b border-border pb-4">
          <strong className="text-primary">Sombra</strong>
        </div>
        <h1 id="login-title" className="text-[28px] font-bold leading-tight">Вход в аккаунт</h1>
        <form className="mt-6 grid gap-4" onSubmit={submit} onChange={() => setError("")}>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Электронная почта</Label>
            <Input id="email" name="email" type="email" autoComplete="username" placeholder="you@example.com" required maxLength={254} className="login-input h-11" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Пароль</Label>
            <div className="relative">
              <Input id="password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" placeholder="Введите пароль" required className="login-input login-password h-11 pr-12" />
              <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Скрыть пароль" : "Показать пароль"} aria-pressed={visible} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex min-h-7 items-center gap-2.5 text-sm">
              <Checkbox.Root id="remember-me" name="remember_me" value="on" aria-describedby="remember-hint" className="relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-input/30 after:absolute after:-inset-1 focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"><Checkbox.Indicator><CheckIcon className="size-3.5" /></Checkbox.Indicator></Checkbox.Root>
              <Label htmlFor="remember-me" className="cursor-pointer font-normal">Оставаться в системе</Label>
            </div>
            <p id="remember-hint" className="pl-[26px] text-xs text-muted-foreground">Сохранять вход на этом устройстве в течение года.</p>
          </div>
          {error && <p role="alert" className="text-sm leading-5 text-destructive">{error}</p>}
          <Button disabled={busy} type="submit" className="h-11 w-full text-sm">Войти</Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          Нет аккаунта?{" "}
          <a href="#register" className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Создать аккаунт</a>
        </p>
      </section>
    </main>
  );
}

