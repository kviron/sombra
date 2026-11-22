import {cn} from '@/shared/lib';
import animatedMark from './sombra-mark.gif';
import staticMark from './sombra-mark.png';

export function SombraMark({className}: {className?: string}) {
 return (
  <picture aria-hidden="true" className={cn('sombra-mark block size-6 shrink-0', className)}>
   <source media="(prefers-reduced-motion: no-preference)" srcSet={animatedMark} />
   <img src={staticMark} alt="" width={640} height={640} className="size-full object-contain" />
  </picture>
 );
}
