import {Fragment, type KeyboardEvent, type ReactElement, type ReactNode} from 'react';
import {ContextMenu} from 'radix-ui';
import type {LucideIcon} from 'lucide-react';
import './menu-material.css';

type Action = {
 label: string;
 icon?: LucideIcon;
 onSelect: () => void;
 disabled?: boolean;
 separator?: boolean;
};

type EntityContextMenuProps = {
 children: ReactElement;
 actions?: Action[];
 controls?: ReactNode;
};

export function EntityContextMenu({children, actions = [], controls}: EntityContextMenuProps) {
 if (!actions.length && !controls) return children;

 function focusNextControl(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab') return;
  const items = [
   ...event.currentTarget.querySelectorAll<HTMLElement>('[role="slider"], [role="menuitem"]:not([data-disabled])')
  ];
  const current = items.indexOf(document.activeElement as HTMLElement);
  const step = event.shiftKey ? -1 : 1;
  const next = current < 0 && event.shiftKey ? items.length - 1 : (current + step + items.length) % items.length;
  event.preventDefault();
  items[next]?.focus();
 }

 return (
  <ContextMenu.Root modal={false}>
   <ContextMenu.Trigger asChild aria-haspopup="menu">
    {children}
   </ContextMenu.Trigger>
   <ContextMenu.Portal>
    <ContextMenu.Content
     data-slot="context-menu-content"
     collisionPadding={8}
     onKeyDown={controls ? focusNextControl : undefined}
     onCloseAutoFocus={event => {
      if (document.activeElement !== document.body) event.preventDefault();
     }}
     className="sombra-menu-surface border-border bg-popover text-popover-foreground z-[100] max-w-[calc(100vw-16px)] min-w-44 rounded-md border p-1 text-sm shadow-md"
    >
     {controls}
     {controls && actions.length > 0 && <ContextMenu.Separator className="bg-border mx-1 my-1 h-px" />}
     {actions.map(({label, icon: Icon, onSelect, disabled, separator}) => (
      <Fragment key={label}>
       {separator && <ContextMenu.Separator className="bg-border mx-1 my-1 h-px" />}
       <ContextMenu.Item
        data-slot="context-menu-item"
        disabled={disabled}
        onSelect={onSelect}
        className="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none select-none data-[disabled]:opacity-45"
       >
        {Icon && <Icon size={16} aria-hidden="true" />}
        {label}
       </ContextMenu.Item>
      </Fragment>
     ))}
    </ContextMenu.Content>
   </ContextMenu.Portal>
  </ContextMenu.Root>
 );
}
