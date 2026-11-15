import type {ComponentProps} from 'react';
import {Slot} from 'radix-ui';
import {cn} from '@/shared/lib/utils';

// Adapted from shadcn/ui's non-collapsible Sidebar and menu primitives.
// Settings keeps navigation visible at every size, so no viewport drawer is needed.
export function Sidebar({className, ...props}: ComponentProps<'aside'>) {
  return <aside data-sidebar="sidebar" className={cn('flex h-full shrink-0 flex-col bg-sidebar text-sidebar-foreground',className)} {...props}/>;
}
export function SidebarHeader({className,...props}: ComponentProps<'div'>) {
  return <div data-sidebar="header" className={cn('flex flex-col gap-2 p-2',className)} {...props}/>;
}
export function SidebarContent({className,...props}: ComponentProps<'div'>) {
  return <div data-sidebar="content" className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto',className)} {...props}/>;
}
export function SidebarFooter({className,...props}: ComponentProps<'div'>) {
  return <div data-sidebar="footer" className={cn('flex flex-col gap-2 p-2',className)} {...props}/>;
}
export function SidebarMenu({className,...props}: ComponentProps<'ul'>) {
  return <ul data-sidebar="menu" className={cn('flex w-full min-w-0 flex-col gap-1',className)} {...props}/>;
}
export function SidebarMenuItem({className,...props}: ComponentProps<'li'>) {
  return <li data-sidebar="menu-item" className={cn('relative',className)} {...props}/>;
}
export function SidebarMenuButton({className,asChild=false,isActive=false,...props}: ComponentProps<'button'> & {asChild?:boolean;isActive?:boolean}) {
  const Comp=asChild?Slot.Root:'button';
  return <Comp data-sidebar="menu-button" data-active={isActive} className={cn('flex min-h-8 w-full items-center gap-2 rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0',className)} {...props}/>;
}
