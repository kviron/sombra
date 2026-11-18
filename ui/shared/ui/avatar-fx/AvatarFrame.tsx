import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/shared/lib/utils';
import { DecorationLayerRenderer, planLayerCanvas } from './engine.ts';
import { layerKey, normalizeDecoration, sceneKey } from './normalize.ts';
import { planSceneCanvas, SceneRenderer } from './scene.ts';
import { registerFxJob, type FxJobHandle } from './scheduler.ts';
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
 * input is the decoration document. Animation is handled by the shared scheduler (visible-on-screen only,
 * capped number of concurrently animated canvases, static frame otherwise, reduced motion respected).
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

/** A whole-cover pixel scene: one opaque canvas for the backdrop, sky effect and the running character. */
function AvatarScene({ decoration, className }: { decoration: AvatarDecoration; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<FxJobHandle | null>(null);
  const visibleRef = useRef(false);
  const key = sceneKey(decoration);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` already names every field of the document.
  const plan = useMemo(() => planSceneCanvas(decoration.layers[0]?.scale ?? 1), [key]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const renderer = new SceneRenderer(decoration);
    canvas.width = renderer.plan.gridWidth;
    canvas.height = renderer.plan.gridHeight;
    const image = context.createImageData(renderer.plan.gridWidth, renderer.plan.gridHeight);
    const paint = () => {
      renderer.render(image.data);
      context.putImageData(image, 0, 0);
    };
    const handle = registerFxJob({ canvas, advance: (dt) => renderer.advance(dt), paint });
    handleRef.current = handle;
    handle.setVisible(visibleRef.current);
    return () => {
      handleRef.current = null;
      handle.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers the document.
  }, [key]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof IntersectionObserver === 'undefined') {
      visibleRef.current = true;
      handleRef.current?.setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible === visibleRef.current) return;
        visibleRef.current = visible;
        handleRef.current?.setVisible(visible);
      },
      { rootMargin: '96px 0px', threshold: 0.01 },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

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
        ref={canvasRef}
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
  const handleRef = useRef<FxJobHandle | null>(null);
  const visibleRef = useRef(false);
  const key = layerKey(layer, target, seed);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` already names every field of `layer`.
  const plan = useMemo(() => planLayerCanvas(layer, target, size), [key, target, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const renderer = new DecorationLayerRenderer(layer, target, size, seed);
    canvas.width = renderer.plan.gridWidth;
    canvas.height = renderer.plan.gridHeight;
    const image = context.createImageData(renderer.plan.gridWidth, renderer.plan.gridHeight);
    const paint = () => {
      renderer.render(image.data);
      context.putImageData(image, 0, 0);
    };
    const handle = registerFxJob({ canvas, advance: (dt) => renderer.advance(dt), paint });
    handleRef.current = handle;
    handle.setVisible(visibleRef.current);
    return () => {
      handleRef.current = null;
      handle.dispose();
    };
    // `key` already covers every field of the layer; `layer` is only the current instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, target, size, seed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof IntersectionObserver === 'undefined') {
      visibleRef.current = true;
      handleRef.current?.setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible === visibleRef.current) return;
        visibleRef.current = visible;
        handleRef.current?.setVisible(visible);
      },
      { rootMargin: '96px 0px', threshold: 0.01 },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

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
      ref={canvasRef}
      className={cn('avatar-fx__canvas', `avatar-fx__canvas--${plan.kind}`)}
      style={style}
      aria-hidden="true"
      data-avatar-fx-effect={layer.effect}
      data-avatar-fx-anchor={layer.anchor}
    />
  );
}
