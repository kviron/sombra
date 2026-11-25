import {Tooltip as TooltipPrimitive} from '@base-ui/react/tooltip';
import {useId, type ComponentProps, type ReactElement, type ReactNode} from 'react';
import {cn} from '@/shared/lib/utils';

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipProvider(props: ComponentProps<typeof TooltipPrimitive.Provider>) {
 return <TooltipPrimitive.Provider delay={400} {...props} />;
}

export function TooltipContent({
 className,
 side = 'top',
 sideOffset = 6,
 ...props
}: ComponentProps<typeof TooltipPrimitive.Popup> &
 Pick<ComponentProps<typeof TooltipPrimitive.Positioner>, 'side' | 'sideOffset'>) {
 return (
  <TooltipPrimitive.Portal>
   <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} collisionPadding={8} className="z-[1400]">
    <TooltipPrimitive.Popup
     data-slot="tooltip-content"
     role="tooltip"
     className={cn(
      'border-border bg-popover text-popover-foreground max-w-[min(20rem,calc(100vw-1rem))] rounded-md border px-2.5 py-1.5 text-xs leading-snug wrap-break-word shadow-md',
      'data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-safe:transition-opacity motion-safe:duration-100',
      className
     )}
     {...props}
    />
   </TooltipPrimitive.Positioner>
  </TooltipPrimitive.Portal>
 );
}

type TooltipLabelProps = Omit<ComponentProps<typeof TooltipTrigger>, 'children' | 'render' | 'content'> & {
 content: ReactNode;
 children: ReactElement<{disabled?: boolean; 'aria-describedby'?: string}>;
};

export function TooltipLabel({content, children, ...triggerProps}: TooltipLabelProps) {
 const id = useId();
 const target = children.props.disabled ? <span className="inline-flex min-w-0">{children}</span> : children;
 const description = triggerProps['aria-describedby'] ?? children.props['aria-describedby'];
 const describedBy = content ? [description, id].filter(Boolean).join(' ') : description;
 return (
  <Tooltip>
   <TooltipTrigger render={target} disabled={!content} {...triggerProps} aria-describedby={describedBy} />
   {content && <TooltipContent id={id}>{content}</TooltipContent>}
  </Tooltip>
 );
}
