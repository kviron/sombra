import type {LucideIcon} from 'lucide-react';
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
   className={`motion-icon motion-icon--${kind} ${className}`}
   style={{width: size, height: size}}
  >
   <Icon className="motion-icon__base" size={size} />
   <Icon className="motion-icon__echo motion-icon__echo--cyan" size={size} />
   <Icon className="motion-icon__echo motion-icon__echo--violet" size={size} />
  </span>
 );
}
