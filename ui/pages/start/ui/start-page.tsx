import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import { toast } from "sonner";
import { isTauri, openExternal } from "@/shared/api";
import { DOCS_URL } from "@/shared/config";
import { Button, SombraLogo } from "@/shared/ui";
import { MineField } from "./mine-field";

export function StartPage() {
  const inTauri = isTauri();
  const buildMode = import.meta.env.DEV ? "dev" : "release";

  function openDocumentation() {
    void openExternal(DOCS_URL).catch(() => {
      toast.error("Не удалось открыть ссылку");
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main className="relative flex min-h-0 flex-1 items-center overflow-hidden">
        <div
          aria-hidden="true"
          className="field-canvas pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] lg:block"
        />

        <div className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-16 px-5 py-10 sm:px-6 lg:px-10 lg:py-14">
          <div className="min-w-0 max-w-[560px] flex-1">
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-[2px] bg-signal"
              />
              локальное приложение
            </p>

            <h1 className="mt-5 text-[clamp(3.25rem,7vw,5rem)] leading-[0.92] font-semibold tracking-[-0.04em] text-balance">
              <SombraLogo className="sombra-logo--hero" />
            </h1>

            <p className="mt-4 text-xl tracking-[-0.01em] text-foreground/90">
              Стартовая точка.
            </p>

            <p className="mt-3 max-w-[46ch] text-[15px] leading-relaxed text-pretty text-muted-foreground">
              Оболочка на Tauri, интерфейс на React и shadcn/ui. Дальше — экраны,
              навигация и логика приложения.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-2.5">
              <Button
                size="lg"
                onClick={() =>
                  toast("Стартовый экран", {
                    description: "Следующий экран ещё не подключён.",
                  })
                }
              >
                Начать
                <ArrowRightIcon data-icon="inline-end" />
              </Button>

              <Button variant="outline" size="lg" onClick={openDocumentation}>
                Документация
                <ArrowUpRightIcon data-icon="inline-end" />
              </Button>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <span>Tauri 2</span>
              <span
                aria-hidden="true"
                className="size-1 rounded-full bg-border"
              />
              <span>React 19</span>
              <span
                aria-hidden="true"
                className="size-1 rounded-full bg-border"
              />
              <span>shadcn/ui</span>
            </div>
          </div>

          <div className="hidden shrink-0 lg:block">
            <MineField />
          </div>
        </div>
      </main>

      <footer className="flex h-11 shrink-0 items-center justify-between gap-4 border-t border-border/70 px-5 sm:px-6">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-signal"
          />
          {inTauri ? "ядро tauri подключено" : "веб-предпросмотр"}
        </span>

        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {buildMode}
        </span>
      </footer>
    </div>
  );
}
