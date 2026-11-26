import type {ComponentProps} from 'react';
import {Slot} from 'radix-ui';
import {cn} from '@/shared/lib/utils';

const sidebarMenuButtonSizes = {
 sm: 'min-h-7 text-xs',
 default: 'min-h-8 text-sm',
 lg: 'min-h-12 text-sm'
} as const;

// Adapted from shadcn/ui's non-collapsible Sidebar and menu primitives.
// Settings keeps navigation visible at every size, so no viewport drawer is needed.
export function Sidebar({className, ...props}: ComponentProps<'aside'>) {
 return (
  <aside
   data-sidebar="sidebar"
   className={cn('bg-sidebar text-sidebar-foreground flex h-full shrink-0 flex-col', className)}
   {...props}
  />
 );
}
export function SidebarHeader({className, ...props}: ComponentProps<'div'>) {
 return <div data-sidebar="header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />;
}
export function SidebarContent({className, ...props}: ComponentProps<'div'>) {
 return (
  <div
   data-sidebar="content"
   className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto', className)}
   {...props}
  />
 );
}
export function SidebarFooter({className, ...props}: ComponentProps<'div'>) {
 return <div data-sidebar="footer" className={cn('flex flex-col gap-2 p-2', className)} {...props} />;
}
export function SidebarMenu({className, ...props}: ComponentProps<'ul'>) {
 return <ul data-sidebar="menu" className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />;
}
export function SidebarMenuItem({className, ...props}: ComponentProps<'li'>) {
 return <li data-sidebar="menu-item" className={cn('relative', className)} {...props} />;
}
export function SidebarMenuButton({
 className,
 asChild = false,
 isActive = false,
 size = 'default',
 ...props
}: ComponentProps<'button'> & {asChild?: boolean; isActive?: boolean; size?: keyof typeof sidebarMenuButtonSizes}) {
 const Comp = asChild ? Slot.Root : 'button';
 return (
  <Comp
   data-sidebar="menu-button"
   data-slot="sidebar-menu-button"
   data-size={size}
   data-active={isActive}
   className={cn(
    'ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground flex w-full items-center gap-2 rounded-md p-2 text-left outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 data-[active=true]:font-medium [&>svg]:size-4 [&>svg]:shrink-0',
    sidebarMenuButtonSizes[size],
    className
   )}
   {...props}
  />
 );
}
