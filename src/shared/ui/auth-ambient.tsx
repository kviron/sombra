import {useEffect, useRef} from 'react';
import './auth-ambient.css';
function animate(canvas: HTMLCanvasElement) {
 const context = canvas.getContext('2d');
 if (!context) return;
 const ctx: CanvasRenderingContext2D = context;
 const motion = matchMedia('(prefers-reduced-motion: reduce)');
 const css = getComputedStyle(canvas);
 const palette = ['--primary', '--link', '--glow-cool', '--glow-violet'].map(name => css.getPropertyValue(name).trim());
 const pixel = 3;
 let timer: ReturnType<typeof setTimeout>,
  next = 0;
 function draw(frame: number, side: number) {
  const w = canvas.width,
   h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
  const x = Math.round(w * (side ? 0.73 : 0.15));
  const y = Math.round(h * (side ? 0.76 : 0.24));
  const spread = Math.max(18, Math.round(w * 0.22));
  const strength = 1 - frame / 10;
  for (let i = 0; i < 9; i++) {
   const dx = rand(-20, 20),
    row = y + rand(-18, 18);
   const width = rand(6, spread),
    height = rand(1, 4);
   ctx.globalAlpha = strength * 0.38;
   ctx.fillStyle = palette[0];
   ctx.fillRect(x + dx - 4, row, width, height);
   ctx.fillStyle = palette[1];
   ctx.fillRect(x + dx + 3, row + 1, width, height);
   ctx.globalAlpha = strength * 0.85;
   ctx.fillStyle = palette[2 + (i % 2)];
   ctx.fillRect(x + dx, row, width, height);
  }
  // Color-channel speckles stay local to each tear, not over the whole screen.
  const noise = ['#b681e8', '#6aafce', '#ce729e', '#849cde', palette[1]];
  for (let i = 0; i < 65; i++) {
   const px = x + rand(-25, spread),
    py = y + rand(-30, 30);
   const width = i % 7 === 0 ? rand(4, 9) : rand(1, 2);
   ctx.globalAlpha = (strength * rand(18, 58)) / 100;
   ctx.fillStyle = noise[rand(0, noise.length - 1)];
   ctx.fillRect(px, py, width, i % 9 === 0 ? 2 : 1);
  }
  ctx.globalAlpha = 1;
 }
 function start() {
  clearTimeout(timer);
  canvas.width = Math.ceil(canvas.clientWidth / pixel);
  canvas.height = Math.ceil(canvas.clientHeight / pixel);
  if (motion.matches || document.hidden) return;
  const side = next++ % 2;
  let frame = 0;
  function tick() {
   if (frame < 8) {
    draw(frame++, side);
    timer = setTimeout(tick, 75);
   } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    timer = setTimeout(start, 3100);
   }
  }
  tick();
 }
 motion.addEventListener('change', start);
 document.addEventListener('visibilitychange', start);
 window.addEventListener('resize', start);
 start();
 return () => {
  clearTimeout(timer);
  motion.removeEventListener('change', start);
  document.removeEventListener('visibilitychange', start);
  window.removeEventListener('resize', start);
 };
}

export function AuthAmbient() {
 const canvas = useRef<HTMLCanvasElement>(null);
 useEffect(() => {
  if (canvas.current) return animate(canvas.current);
 }, []);
 return (
  <>
   <div className="auth-gradient" aria-hidden="true" />
   <div className="login-particles" aria-hidden="true">
    <canvas className="login-glitch" ref={canvas} />
   </div>
  </>
 );
}
