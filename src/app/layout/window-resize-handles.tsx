import {startWindowResize, type WindowResizeDirection} from '@/app/lib/window-actions';
import {cn} from '@/shared/lib';

/**
 * Undecorated Windows windows lose their native resize border (tao removes
 * WS_THICKFRAME). These invisible edge handles restore resize on all sides.
 */
const HANDLES: ReadonlyArray<{
 direction: WindowResizeDirection;
 className: string;
}> = [
 {direction: 'North', className: 'inset-x-2 top-0 h-1 cursor-ns-resize'},
 {direction: 'South', className: 'inset-x-2 bottom-0 h-1 cursor-ns-resize'},
 {direction: 'West', className: 'inset-y-2 left-0 w-1 cursor-ew-resize'},
 {direction: 'East', className: 'inset-y-2 right-0 w-1 cursor-ew-resize'},
 {
  direction: 'NorthWest',
  className: 'top-0 left-0 size-2 cursor-nwse-resize'
 },
 {
  direction: 'NorthEast',
  className: 'top-0 right-0 size-2 cursor-nesw-resize'
 },
 {
  direction: 'SouthWest',
  className: 'bottom-0 left-0 size-2 cursor-nesw-resize'
 },
 {
  direction: 'SouthEast',
  className: 'right-0 bottom-0 size-2 cursor-nwse-resize'
 }
];

type WindowResizeHandlesProps = {
 inTauri: boolean;
 isMaximized: boolean;
};

export function WindowResizeHandles({inTauri, isMaximized}: WindowResizeHandlesProps) {
 if (!inTauri || isMaximized) return null;

 return (
  <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50">
   {HANDLES.map(({direction, className}) => (
    <div
     key={direction}
     className={cn('pointer-events-auto absolute', className)}
     onMouseDown={event => {
      event.preventDefault();
      void startWindowResize(direction);
     }}
    />
   ))}
  </div>
 );
}
