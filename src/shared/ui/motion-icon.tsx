import type {LucideIcon} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import './motion-icon.css';

/** Decorative layers inherit the existing button's accessible name and state. */
export function MotionIcon({
 icon: Icon,
 size = 20,
 className = '',
 kind = 'device'
}: {
 icon: LucideIcon;
 size?: number;
 className?: string;
 kind?: 'device' | 'settings' | 'send';
}) {
 return (
  <span
   aria-hidden="true"
   className={cn(
    'motion-icon',
    `motion-icon--${kind}`,
    'pointer-events-none relative inline-grid shrink-0 align-middle transition-[transform,color] duration-[140ms] ease-[ease-out]',
    '[&>svg]:col-start-1 [&>svg]:row-start-1 [&>svg]:m-0',
    className
   )}
   style={{width: size, height: size}}
  >
   <Icon
    className="motion-icon__base size-full transition-[transform] duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
    size={size}
   />
   <Icon
    className="motion-icon__echo motion-icon__echo--cyan text-primary size-full opacity-0 [clip-path:inset(16%_0_49%_0)]"
    size={size}
   />
   <Icon
    className="motion-icon__echo motion-icon__echo--violet text-primary size-full opacity-0 [clip-path:inset(58%_0_12%_0)]"
    size={size}
   />
  </span>
 );
}
