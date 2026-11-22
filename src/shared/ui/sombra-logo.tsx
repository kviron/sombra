import {cn} from '@/shared/lib';
import {SombraMark} from './sombra-mark';

export function SombraLogo({className}: {className?: string}) {
 return (
  <span role="img" aria-label="Sombra" className={cn('sombra-logo', className)}>
   <SombraMark />
   <span className="sombra-wordmark" aria-hidden="true">
    Sombra
   </span>
  </span>
 );
}
