// Types for the vendored pixelfx core slice (see ../VENDOR.md). Hand-written against the upstream code at
// 5294518ce7c72e48b6100a744596e0acf57f2826; TypeScript does not read the .js sources (allowJs stays off).
export interface FxFrame {
  w: number;
  h: number;
  ox: number;
  oy: number;
  color: Uint32Array;
  light: Uint32Array;
}

export interface FxMeta {
  name: string;
  size: [number, number];
  origin: [number, number];
  duration: number;
  loop?: boolean;
  fps?: number;
  actor?: number;
  options?: Record<string, unknown>;
}

export interface FxOptions {
  x: number;
  y: number;
  seed?: number;
  flip?: boolean;
  angle?: number;
  light?: number;
  palette?: string[];
  actor?: false | null | unknown;
  [option: string]: unknown;
}

export interface FxInstance {
  readonly meta: FxMeta;
  readonly options: FxOptions;
  readonly t: number;
  update(dt: number): void;
  draw(frame: FxFrame, layer?: 'back' | 'front'): void;
  stop(): void;
  done(): boolean;
}

export interface FxEffectModule {
  meta: FxMeta;
  create?(options: FxOptions): {
    update?(dt: number, options: FxOptions): void;
    draw?(painter: unknown, t: number, options: FxOptions): void;
    drawBack?(painter: unknown, t: number, options: FxOptions): void;
  };
  draw?(painter: unknown, t: number, options: FxOptions): void;
  drawBack?(painter: unknown, t: number, options: FxOptions): void;
}

export function createFrame(w: number, h: number, ox?: number, oy?: number): FxFrame;
export function clearFrame(frame: FxFrame): FxFrame;
export function createFx(module: FxEffectModule, options?: Partial<FxOptions>): FxInstance;
export function composite(
  frame: FxFrame,
  out: Uint8ClampedArray,
  background?: number | Uint32Array | null,
  light?: number,
): Uint8ClampedArray;
export const PAL: Readonly<Record<string, readonly string[]>>;
