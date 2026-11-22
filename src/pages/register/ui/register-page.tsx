import {Input} from '@/shared/ui/input';
import { authService } from '@/entities/user';
import { useState, type FormEvent } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@/shared/ui";
import { Label } from "@/shared/ui/label";

export function RegisterPage() {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get("password") !== data.get("confirmation")) {
      setError("Пароли не совпадают. Проверьте подтверждение пароля.");
      return;
    }
    setBusy(true); setError("");
    try { await authService.register({email: data.get('email'), password: data.get('password'), name: data.get('username')}); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return (
    <main className="auth-form-page relative flex min-h-0 flex-1 overflow-y-auto px-6 py-10">
      <section aria-labelledby="register-title" className="m-auto w-full max-w-[440px]">
        <div className="mb-6 border-b border-border pb-4">
          <strong className="text-primary">Sombra</strong>
        </div>
        <h1 id="register-title" className="text-[28px] font-bold leading-tight">Создать аккаунт</h1>
        <form className="mt-6 grid gap-4" onSubmit={submit} onChange={() => setError("")}>
          <div className="grid gap-1.5">
            <Label htmlFor="username">Имя пользователя</Label>
            <Input id="username" name="username" autoComplete="username" placeholder="Как вас называть?" required minLength={2} maxLength={32} pattern=".*\S.*" className="login-input h-11" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Электронная почта</Label>
            <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} className="login-input h-11" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Пароль</Label>
            <div className="relative">
              <Input id="password" name="password" type={visible ? "text" : "password"} autoComplete="new-password" placeholder="Не менее 8 символов" required minLength={8} className="login-input login-password h-11 pr-12" />
              <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Скрыть пароль" : "Показать пароль"} aria-pressed={visible} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirmation">Подтвердите пароль</Label>
            <Input id="confirmation" name="confirmation" type={visible ? "text" : "password"} autoComplete="new-password" placeholder="Повторите пароль" required minLength={8} className="login-input h-11" />
          </div>
          {error && <p role="alert" className="text-sm leading-5 text-destructive">{error}</p>}
          <Button disabled={busy} type="submit" className="h-11 w-full text-sm">Создать аккаунт</Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          Уже есть аккаунт?{" "}
          <a href="#login" className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Войти</a>
        </p>
      </section>
    </main>
  );
}


