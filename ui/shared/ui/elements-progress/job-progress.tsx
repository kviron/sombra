// Upstream assistant-ui Elements, MIT. Commit 076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c.
// https://github.com/assistant-ui/assistant-ui/blob/076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c/packages/ui/src/components/react/assistant-ui/elements/job-progress.tsx
//
// Sombra adaptation (colours and sizes only, plus the documented trims below):
//  * The bot transport reports no stage weights and no verified percentage, so the
//    weighted progressbar is omitted instead of inventing numbers. The canonical
//    row anatomy stays: `data-slot="job-progress"`, state icon, title, mono elapsed
//    time, details control, and a sensible accessible name for the row.
//  * The canonical component is a card; this is the compact single-line variant the
//    chat needs above the composer. It expands to one detail line on demand.
//  * The live-region announcement is owned by the Sombra dock (a single role=status
//    container), so this element does not open a second live region.
//  * An optional `startedAt` renders a self-contained, once-per-second elapsed
//    timer, so the chat shell never re-renders just to tick a clock.
import { useEffect, useId, useState } from "react";
import type { ComponentProps } from "react";
import { ChevronDownIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ghostButton, mono, paper } from "./surfaces";

function formatElapsed(elapsedMs: number) {
  const seconds = Math.max(
    0,
    Math.round(Number.isFinite(elapsedMs) ? elapsedMs / 1_000 : 0),
  );
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return {
    dateTime: `PT${seconds}S`,
    label:
      minutes === 0
        ? `${remainder} с`
        : remainder === 0
          ? `${minutes} мин`
          : `${minutes} мин ${remainder} с`,
  };
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = formatElapsed(now - startedAt);
  // Visual only: a clock that ticks every second must not be a live region.
  return (
    <time
      aria-hidden="true"
      dateTime={elapsed.dateTime}
      className={cn(mono, "text-muted-foreground shrink-0 tabular-nums")}
    >
      {elapsed.label}
    </time>
  );
}

export function JobProgress({
  title,
  stage,
  detail,
  startedAt,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "title"> & {
  title: string;
  /** Optional stage reported by the bot; never inferred. */
  stage?: string | undefined;
  /** Optional human-readable detail shown behind the expand control. */
  detail?: string | undefined;
  /** Epoch milliseconds; renders the canonical mono elapsed time. */
  startedAt?: number | undefined;
}) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const expandable = !!detail;

  return (
    <div
      data-slot="job-progress"
      data-state="running"
      data-variant="inline"
      className={cn(
        paper,
        "flex w-fit max-w-full min-w-0 flex-col gap-1 rounded-full px-2.5 py-1",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Loader2Icon
          aria-hidden="true"
          className="text-muted-foreground size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
        />
        <span className="min-w-0 truncate text-[13px] font-medium">
          {title}
          {stage ? ` · ${stage}` : ""}
        </span>
        {startedAt !== undefined ? <Elapsed startedAt={startedAt} /> : null}
        {expandable ? (
          <button
            type="button"
            aria-label={expanded ? "Скрыть подробности" : "Подробности задачи"}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((value) => !value)}
            className={cn(ghostButton, "size-5 shrink-0")}
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 transition-transform motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
            />
          </button>
        ) : null}
      </div>
      {expandable && expanded ? (
        <p
          id={panelId}
          className="text-muted-foreground max-w-72 text-xs leading-4 break-words"
        >
          {detail}
        </p>
      ) : null}
    </div>
  );
}
