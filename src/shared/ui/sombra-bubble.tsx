import type {ComponentProps} from 'react';
import {cn} from 'cn';

export function Bubble({className, ...props}: ComponentProps<'div'>) {
 return <div data-slot="bubble" className={cn('message-bubble', className)} {...props} />;
}

export function BubbleContent({className, ...props}: ComponentProps<'div'>) {
 return <div data-slot="bubble-content" className={cn('bubble-content', className)} {...props} />;
}
