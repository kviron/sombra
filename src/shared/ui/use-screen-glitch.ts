import {useEffect, useRef} from 'react';

/** Animate the existing surface without remounting media or losing focus. */
export function useScreenGlitch(screen: string) {
 const ref = useRef<HTMLDivElement>(null);
 useEffect(() => {
  const node = ref.current;
  if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const animation = node.animate(
   [
    {transform: 'translateX(0)', filter: 'none', offset: 0},
    {transform: 'translateX(-2px)', filter: 'drop-shadow(2px 0 #62e8ef70)', offset: 0.12},
    {transform: 'translateX(1px)', filter: 'drop-shadow(-2px 0 #c297ff70)', offset: 0.24},
    {transform: 'translateX(0)', filter: 'none', offset: 0.38},
    {transform: 'translateX(-1px)', filter: 'drop-shadow(1px 0 #62e8ef40)', offset: 0.52},
    {transform: 'translateX(0)', filter: 'none', offset: 0.68},
    {transform: 'translateX(0)', filter: 'none', offset: 1}
   ],
   {duration: 220, easing: 'steps(1,end)'}
  );
  return () => animation.cancel();
 }, [screen]);
 return ref;
}
