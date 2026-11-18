import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { cn } from '@/shared/lib/utils';
import { DecorationLayerRenderer, planLayerCanvas } from './engine.ts';
import { layerKey, normalizeDecoration, sceneKey } from './normalize.ts';
import { planSceneCanvas, SceneRenderer } from './scene.ts';
import { registerFxJob } from './scheduler.ts';
import type { AvatarDecoration, AvatarSize, DecorationInput, DecorationTarget, NormalizedLayer } from './types.ts';
import './avatar-fx.css';

export interface AvatarFrameProps {
  /** A v1 decoration document (or a normalized one). `null`/`undefined` renders nothing. */
  decoration?: DecorationInput | AvatarDecoration | null;
  target?: DecorationTarget;
  /** Avatar size tier; the ring grid follows it so one effect pixel stays one CSS pixel. */
  size?: AvatarSize;
  className?: string;
}

/**
 * Pixel-art decoration for a user avatar or a profile cover.
 *
 * The canvases are invisible to assistive tech, never take pointer events and never fetch anything: the only
 * input is the decoration document. The shared scheduler paints visible canvases and caps concurrent animation.
 */
export function AvatarFrame({ decoration, target = 'avatar', size = 'md', className }: AvatarFrameProps) {
  const normalized = useMemo(() => normalizeDecoration(decoration, { target }).value, [decoration, target]);
  if (!normalized) return null;
  if (normalized.mode === 'scene') return <AvatarScene decoration={normalized} className={className} />;
  return (
    <span className={cn('avatar-fx', `avatar-fx--${target}`, className)} aria-hidden="true" data-mode="frame">
      {normalized.layers.map((layer, index) => (
        <AvatarFxLayer
          key={`${index}:${layerKey(layer, target, normalized.seed)}`}
          layer={layer}
          target={target}
          size={size}
          seed={normalized.seed}
        />
      ))}
    </span>
  );
}

/** Don't initialize a simulation, drawing context or pixel buffer before its first scheduled paint. */
function observeCanvas(canvas: HTMLCanvasElement, createRenderer: () => {
  advance(dt: number): void;
  render(pixels: Uint8ClampedArray): void;
}) {
  let renderer: ReturnType<typeof createRenderer> | undefined;
  let context: CanvasRenderingContext2D | null | undefined;
  let image: ImageData;
  const handle = registerFxJob({
    canvas,
    advance: (dt) => renderer?.advance(dt),
    paint() {
      if (context === undefined) {
        context = canvas.getContext('2d');
        if (context) {
          renderer = createRenderer();
          image = context.createImageData(canvas.width, canvas.height);
        }
      }
      if (!context || !renderer) return;
      renderer.render(image.data);
      context.putImageData(image, 0, 0);
    },
  });
  return handle.dispose;
}

/** A whole-cover pixel scene: one opaque canvas for the backdrop, sky effect and the running character. */
function AvatarScene({ decoration, className }: { decoration: AvatarDecoration; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const key = sceneKey(decoration);
  const scale = decoration.layers[0]?.scale ?? 1;
  const plan = useMemo(() => planSceneCanvas(scale), [scale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return observeCanvas(canvas, () => new SceneRenderer(decoration));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers the document.
  }, [key]);

  const style: CSSProperties = {
    width: plan.cssWidth,
    height: plan.cssHeight,
    left: plan.left,
    top: plan.top,
    transform: plan.transform,
  };
  return (
    <span className={cn('avatar-fx', 'avatar-fx--cover', 'avatar-fx--scene', className)} aria-hidden="true" data-mode="scene">
      <canvas
        key={key}
        ref={canvasRef}
        width={plan.gridWidth}
        height={plan.gridHeight}
        className="avatar-fx__canvas avatar-fx__canvas--scene"
        style={style}
        aria-hidden="true"
        data-avatar-fx-effect="scene"
      />
    </span>
  );
}

function AvatarFxLayer({
  layer,
  target,
  size,
  seed,
}: {
  layer: NormalizedLayer;
  target: DecorationTarget;
  size: AvatarSize;
  seed: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const key = layerKey(layer, target, seed);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` already names every field of `layer`.
  const plan = useMemo(() => planLayerCanvas(layer, target, size), [key, target, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return observeCanvas(canvas, () => new DecorationLayerRenderer(layer, target, size, seed));
    // `key` already covers every field of the layer; `layer` is only the current instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, target, size, seed]);

  const style: CSSProperties = {
    width: plan.cssWidth,
    height: plan.cssHeight,
    opacity: plan.opacity,
    left: plan.left,
    right: plan.right,
    top: plan.top,
    bottom: plan.bottom,
    transform: plan.transform,
    mixBlendMode: plan.blend === 'screen' ? 'screen' : undefined,
  };
  return (
    <canvas
      key={size}
      ref={canvasRef}
      width={plan.gridWidth}
      height={plan.gridHeight}
      className={cn('avatar-fx__canvas', `avatar-fx__canvas--${plan.kind}`)}
      style={style}
      aria-hidden="true"
      data-avatar-fx-effect={layer.effect}
      data-avatar-fx-anchor={layer.anchor}
    />
  );
}
