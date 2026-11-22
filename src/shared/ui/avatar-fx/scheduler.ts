// One observer and one requestAnimationFrame loop for all avatar/cover canvases.
export const MAX_ANIMATED_FX = 4;
export const FX_FPS = 30;
const FRAME_MS = 1000 / FX_FPS;
const STATIC_PAINTS_PER_FRAME = 4;

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

type FxPriority = 'profile' | 'picker' | null;
interface FxJob extends FxJobInput {
 priority: FxPriority;
 visible: boolean;
 painted: boolean;
 lastPaintAt?: number;
}

const jobs = new Map<HTMLCanvasElement, FxJob>();
// Iterate only the visible jobs, in priority order, at most once per browser frame.
const visibleByPriority = new Map<FxPriority, Set<FxJob>>([
 ['profile', new Set()],
 ['picker', new Set()],
 [null, new Set()]
]);
let visibleCount = 0;
let observer: IntersectionObserver | undefined;
let rafId: number | null = null;
let dirty = false;
let animated: FxJob[] = [];
let ordinary: FxJob[] = [];
let ordinaryCursor = 0;
let staticQueue: FxJob[] = [];
let staticIndex = 0;
let lastAdvance: number | null = null;
let nextPaint = 0;
const stats = {frames: 0, paints: 0, lastPaintMs: 0};

const noopHandle: FxJobHandle = {setVisible() {}, dispose() {}};

function hasDom(): boolean {
 return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function setJobVisible(job: FxJob, visible: boolean): void {
 if (job.visible === visible) return;
 job.visible = visible;
 const bucket = visibleByPriority.get(job.priority)!;
 if (visible) bucket.add(job);
 else bucket.delete(job);
 visibleCount += visible ? 1 : -1;
 dirty = true;
 ensureLoop();
}

function bindEnvironment(): void {
 document.addEventListener('visibilitychange', ensureLoop);
 if (typeof IntersectionObserver !== 'undefined') {
  observer = new IntersectionObserver(
   entries => {
    for (const entry of entries) {
     const job = jobs.get(entry.target as HTMLCanvasElement);
     if (job) setJobVisible(job, entry.isIntersecting);
    }
   },
   {rootMargin: '96px 0px', threshold: 0.01}
  );
 }
}

function reconcile(): void {
 dirty = false;
 animated = [];
 staticQueue = [];
 staticIndex = 0;
 ordinary = [...visibleByPriority.get(null)!];
 for (const priority of ['profile', 'picker'] as const) {
  for (const job of visibleByPriority.get(priority)!) {
   if (animated.length < MAX_ANIMATED_FX) animated.push(job);
   else if (!job.painted) staticQueue.push(job);
  }
 }
 const slots = MAX_ANIMATED_FX - animated.length;
 if (ordinary.length > slots) for (const job of ordinary) if (!job.painted) staticQueue.push(job);
}

function stopLoop(): void {
 if (rafId !== null) window.cancelAnimationFrame(rafId);
 rafId = null;
 lastAdvance = null;
}

function ensureLoop(): void {
 if (document.hidden || !visibleCount) {
  stopLoop();
  if (!visibleCount) reconcile();
 } else if (rafId === null && (dirty || animated.length || ordinary.length || staticIndex < staticQueue.length)) {
  rafId = window.requestAnimationFrame(tick);
 }
}

function paint(job: FxJob): void {
 job.paint();
 job.painted = true;
 stats.paints += 1;
}

function tick(now: number): void {
 rafId = null;
 if (document.hidden || !visibleCount) return;
 if (dirty) reconcile();
 if (lastAdvance === null || now >= nextPaint - 1) {
  const started = performance.now();
  const dt = lastAdvance === null ? 0 : Math.min(0.1, (now - lastAdvance) / 1000);
  nextPaint = lastAdvance === null ? now + FRAME_MS : Math.max(nextPaint + FRAME_MS, now);
  lastAdvance = now;
  const frameJobs = [...animated];
  const slots = Math.min(MAX_ANIMATED_FX - frameJobs.length, ordinary.length);
  for (let i = 0; i < slots; i++) {
   ordinaryCursor %= ordinary.length;
   frameJobs.push(ordinary[ordinaryCursor++]);
  }
  for (const job of frameJobs) {
   const elapsed = job.lastPaintAt === undefined || dt === 0 ? dt : Math.min(0.25, (now - job.lastPaintAt) / 1000);
   if (job.painted && elapsed > 0) job.advance(elapsed);
   job.lastPaintAt = now;
   paint(job);
  }
  stats.frames += 1;
  stats.lastPaintMs = performance.now() - started;
 }
 // An overflow burst should not block the renderer with dozens of first paints in one frame.
 const end = Math.min(staticQueue.length, staticIndex + STATIC_PAINTS_PER_FRAME);
 while (staticIndex < end) {
  const job = staticQueue[staticIndex++];
  if (!job.painted) paint(job);
 }
 if (staticIndex === staticQueue.length) {
  staticQueue = [];
  staticIndex = 0;
 }
 ensureLoop();
}

export function registerFxJob(input: FxJobInput): FxJobHandle {
 if (!hasDom()) return noopHandle;
 if (!jobs.size) bindEnvironment();
 const marker = input.canvas.closest('[data-avatar-fx-priority]')?.getAttribute('data-avatar-fx-priority');
 const priority = marker === 'profile' || marker === 'picker' ? marker : null;
 const job: FxJob = {...input, priority, visible: false, painted: false};
 jobs.set(job.canvas, job);
 if (observer) observer.observe(job.canvas);
 else setJobVisible(job, true);
 return {
  setVisible(visible: boolean) {
   if (jobs.get(job.canvas) === job) setJobVisible(job, visible);
  },
  dispose() {
   if (jobs.get(job.canvas) !== job) return;
   observer?.unobserve(job.canvas);
   jobs.delete(job.canvas);
   setJobVisible(job, false);
   if (!jobs.size) {
    observer?.disconnect();
    observer = undefined;
    document.removeEventListener('visibilitychange', ensureLoop);
   }
  }
 };
}

/** Read-only counters for QA and for the preview page; never used by the app UI. */
export function fxSchedulerState() {
 return {
  jobs: jobs.size,
  visible: visibleCount,
  animated: Math.min(MAX_ANIMATED_FX, animated.length + ordinary.length),
  painted: [...jobs.values()].filter(job => job.visible && job.painted).length,
  hidden: hasDom() ? document.hidden : false,
  running: rafId !== null,
  ...stats
 };
}
