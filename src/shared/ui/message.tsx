import type {ComponentProps} from 'react';
import {cn} from '@/shared/lib/utils';

// Adapted locally from the documented shadcn/ui Message composition.
// https://ui.shadcn.com/docs/components/base/message
export function Message({align = 'start', className, ...props}: ComponentProps<'article'> & {align?: 'start' | 'end'}) {
 return <article data-slot="message" data-align={align} className={cn('chat-message', className)} {...props} />;
}
export function MessageAvatar({className, ...props}: ComponentProps<'div'>) {
 return <div data-slot="message-avatar" className={cn('message-avatar', className)} {...props} />;
}
export function MessageContent({className, ...props}: ComponentProps<'div'>) {
 return <div data-slot="message-content" className={cn('message-content', className)} {...props} />;
}
export function MessageHeader({className, ...props}: ComponentProps<'div'>) {
 return <div data-slot="message-header" className={cn('message-meta', className)} {...props} />;
}
export function MessageFooter({className, ...props}: ComponentProps<'div'>) {
 return <div data-slot="message-footer" className={cn('message-footer', className)} {...props} />;
}
export function Bubble({className, ...props}: ComponentProps<'div'>) {
 return <div data-slot="bubble" className={cn('message-bubble', className)} {...props} />;
}
export function BubbleContent({className, ...props}: ComponentProps<'div'>) {
 return <div data-slot="bubble-content" className={cn('bubble-content', className)} {...props} />;
}
