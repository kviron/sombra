import { cn } from "@/shared/lib";

const FIELD_SIZE = 5;
const MINE_CELL = 7;
const cells = Array.from({ length: FIELD_SIZE * FIELD_SIZE }, (_, index) => index);

/**
 * A quiet five-by-five field used as the start screen's visual anchor.
 * Purely decorative: the live cell is the only highlight.
 */
export function MineField({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "grid w-[300px] grid-cols-5 gap-2.5 select-none",
        className,
      )}
    >
      {cells.map((cell) => {
        const isMine = cell === MINE_CELL;

        return (
          <div
            key={cell}
            style={{ animationDelay: `${cell * 16}ms` }}
            className={cn(
              "field-cell relative aspect-square rounded-lg border",
              isMine
                ? "border-signal/50 bg-signal/10"
                : "border-border/80 bg-card/40 dark:bg-card/60",
            )}
          >
            {isMine ? (
              <span className="signal-pulse absolute inset-0 m-auto size-2 rounded-full bg-signal" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
