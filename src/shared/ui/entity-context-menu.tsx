import {Fragment, type KeyboardEvent, type ReactElement, type ReactNode} from 'react';
import type {LucideIcon} from 'lucide-react';
import {
 ContextMenu,
 ContextMenuContent,
 ContextMenuGroup,
 ContextMenuItem,
 ContextMenuSeparator,
 ContextMenuTrigger
} from './context-menu';
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
  <ContextMenu modal={false}>
   <ContextMenuTrigger asChild aria-haspopup="menu">
    {children}
   </ContextMenuTrigger>
   <ContextMenuContent
    collisionPadding={8}
    onKeyDown={controls ? focusNextControl : undefined}
    onCloseAutoFocus={event => {
     if (document.activeElement !== document.body) event.preventDefault();
    }}
    className="sombra-menu-surface"
   >
    {controls}
    {controls && actions.length > 0 && <ContextMenuSeparator />}
    {actions.length > 0 && (
     <ContextMenuGroup>
      {actions.map(({label, icon: Icon, onSelect, disabled, separator}) => (
       <Fragment key={label}>
        {separator && <ContextMenuSeparator />}
        <ContextMenuItem disabled={disabled} onSelect={onSelect}>
         {Icon && <Icon size={16} aria-hidden="true" />}
         {label}
        </ContextMenuItem>
       </Fragment>
      ))}
     </ContextMenuGroup>
    )}
   </ContextMenuContent>
  </ContextMenu>
 );
}
