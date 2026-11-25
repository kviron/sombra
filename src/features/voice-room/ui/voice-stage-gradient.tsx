import {MeshGradient} from '@paper-design/shaders-react';
import {useEffect, useRef, useState} from 'react';

const stops = [
 'var(--background)',
 'color-mix(in srgb, var(--primary) 22%, var(--background))',
 'color-mix(in srgb, var(--primary) 44%, var(--background))',
 'color-mix(in srgb, var(--primary) 30%, var(--background))'
];

export function VoiceStageGradient() {
 const layer = useRef<HTMLDivElement>(null);
 const [colors, setColors] = useState<string[]>([]);

 useEffect(() => {
  const element = layer.current;
  if (!element) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) return;
  const webgl = document.createElement('canvas').getContext('webgl2');
  if (!webgl) return;
  webgl.getExtension('WEBGL_lose_context')?.loseContext();

  function sync() {
   if (!element || !context || motion.matches) {
    setColors([]);
    return;
   }
   // Resolve the active theme's CSS colors to sRGB for Paper.
   const probe = document.createElement('span');
   element.appendChild(probe);
   const palette = stops.map(color => {
    probe.style.color = color;
    context.fillStyle = getComputedStyle(probe).color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
   });
   probe.remove();
   setColors(palette);
  }

  const theme = new MutationObserver(sync);
  theme.observe(document.documentElement, {
   attributes: true,
   attributeFilter: ['class', 'data-accent', 'data-theme', 'style']
  });
  motion.addEventListener('change', sync);
  sync();
  return () => {
   theme.disconnect();
   motion.removeEventListener('change', sync);
  };
 }, []);

 return (
  <div
   ref={layer}
   aria-hidden="true"
   className="pointer-events-none absolute inset-0 -z-10"
   style={{background: `radial-gradient(ellipse at bottom, ${stops[1]}, var(--background) 75%)`}}
  >
   {colors.length > 0 && (
    <MeshGradient
     width="100%"
     height="100%"
     colors={colors}
     speed={0.18}
     distortion={0.45}
     swirl={0.22}
     grainMixer={0}
     grainOverlay={0}
     maxPixelCount={700_000}
     className="mask-[linear-gradient(to_top,black,transparent)]"
    />
   )}
  </div>
 );
}
