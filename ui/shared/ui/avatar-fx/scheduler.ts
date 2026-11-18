// One shared requestAnimationFrame loop for every avatar/cover effect in the app.
//
// Budget: at most MAX_ANIMATED_FX canvases animate at once. Visible canvases over the budget get a single
// static frame instead of updates. Everything stops when the document is hidden, when nothing is visible, or
// when the user prefers reduced motion. Off-screen canvases are never painted until they scroll in.
export const MAX_ANIMATED_FX = 4;
export const FX_FPS = 30;
const FRAME_MS = 1000 / FX_FPS;

export interface FxJobInput {
  canvas: HTMLCanvasElement;
  /** Advance the effect by real seconds. */
  advance(dt: number): void;
  /** Draw the current instant into the canvas. */
  paint(): void;
}

export interface FxJobHandle {
  setVisible(visible: boolean): void;
  dispose(): void;
}

interface FxJob extends FxJobInput {
  id: number;
  visible: boolean;
  animate: boolean;
  painted: boolean;
}

const jobs = new Map<number, FxJob>();
let nextId = 1;
let usingBrowser = false;
let reducedMotion = false;
let rafId = 0;
let lastAdvance = 0;
let motionQuery: MediaQueryList | null = null;
const stats = { frames: 0, paints: 0, lastPaintMs: 0 };

const noopHandle: FxJobHandle = { setVisible() {}, dispose() {} };

function hasDom(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function onVisibilityChange(): void {
  if (!document.hidden) lastAdvance = 0;
  sync();
}

function onMotionChange(event: MediaQueryListEvent): void {
  reducedMotion = event.matches;
  sync();
}

function bindEnvironment(): void {
  if (usingBrowser || !hasDom()) return;
  usingBrowser = true;
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', onMotionChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function unbindEnvironment(): void {
  if (!usingBrowser) return;
  usingBrowser = false;
  motionQuery?.removeEventListener('change', onMotionChange);
  motionQuery = null;
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

function paintStatic(job: FxJob): void {
  if (!job.visible) return;
  job.paint();
  job.painted = true;
  stats.paints += 1;
}

/**
 * Recompute which jobs animate, paint the ones that just lost their slot once, and start or stop the loop.
 * Cheap (a handful of jobs), safe to call on every visibility change.
 */
function sync(): void {
  let budget = reducedMotion ? 0 : MAX_ANIMATED_FX;
  for (const job of jobs.values()) {
    const animate = job.visible && budget > 0;
    if (animate) budget -= 1;
    if (animate === job.animate) continue;
    job.animate = animate;
    if (!animate) paintStatic(job);
  }
  for (const job of jobs.values()) if (job.visible && !job.animate && !job.painted) paintStatic(job);
  ensureLoop();
}

function stopLoop(): void {
  if (rafId) window.cancelAnimationFrame(rafId);
  rafId = 0;
}

function ensureLoop(): void {
  if (!hasDom()) return;
  const shouldRun = !document.hidden && !reducedMotion && [...jobs.values()].some((job) => job.animate);
  if (!shouldRun) {
    stopLoop();
    return;
  }
  if (!rafId) {
    lastAdvance = 0;
    rafId = window.requestAnimationFrame(tick);
  }
}

function tick(now: number): void {
  rafId = 0;
  if (!hasDom() || document.hidden || reducedMotion || ![...jobs.values()].some((job) => job.animate)) return;
  if (!lastAdvance) lastAdvance = now;
  const elapsed = now - lastAdvance;
  if (elapsed < FRAME_MS - 1) {
    rafId = window.requestAnimationFrame(tick);
    return;
  }
  const dt = Math.min(0.1, elapsed / 1000);
  lastAdvance = now;
  const started = performance.now();
  for (const job of jobs.values()) {
    if (!job.animate) continue;
    job.advance(dt);
    job.paint();
    job.painted = true;
    stats.paints += 1;
  }
  stats.frames += 1;
  stats.lastPaintMs = performance.now() - started;
  rafId = window.requestAnimationFrame(tick);
}

export function registerFxJob(input: FxJobInput): FxJobHandle {
  if (!hasDom()) return noopHandle;
  bindEnvironment();
  const job: FxJob = { ...input, id: nextId++, visible: false, animate: false, painted: false };
  jobs.set(job.id, job);
  sync();
  return {
    setVisible(visible: boolean) {
      if (job.visible === visible) return;
      job.visible = visible;
      if (!visible) job.painted = false;
      sync();
    },
    dispose() {
      jobs.delete(job.id);
      if (jobs.size === 0) {
        stopLoop();
        unbindEnvironment();
      } else {
        sync();
      }
    },
  };
}

/** Read-only counters for QA and for the preview page; never used by the app UI. */
export function fxSchedulerState(): {
  jobs: number;
  visible: number;
  animated: number;
  painted: number;
  reducedMotion: boolean;
  hidden: boolean;
  running: boolean;
  frames: number;
  paints: number;
  lastPaintMs: number;
} {
  const list = [...jobs.values()];
  return {
    jobs: list.length,
    visible: list.filter((job) => job.visible).length,
    animated: list.filter((job) => job.animate).length,
    painted: list.filter((job) => job.painted).length,
    reducedMotion,
    hidden: hasDom() ? document.hidden : false,
    running: rafId !== 0,
    frames: stats.frames,
    paints: stats.paints,
    lastPaintMs: stats.lastPaintMs,
  };
}
