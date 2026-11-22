import type {ReactNode} from 'react';
import {closeWindow, minimizeWindow, toggleMaximizeWindow} from '@/app/lib/window-actions';
import {cn} from '@/shared/lib';

type WindowControlsProps = {
 inTauri: boolean;
 isMaximized: boolean;
};

export function WindowControls({inTauri, isMaximized}: WindowControlsProps) {
 if (!inTauri) return null;

 return (
  <div className="flex h-full items-stretch" data-no-drag>
   <ControlButton label="Свернуть" onClick={() => void minimizeWindow()}>
    <MinimizeIcon />
   </ControlButton>

   <ControlButton label={isMaximized ? 'Восстановить' : 'Развернуть'} onClick={() => void toggleMaximizeWindow()}>
    {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
   </ControlButton>

   <ControlButton label="Закрыть" close onClick={() => void closeWindow()}>
    <CloseIcon />
   </ControlButton>
  </div>
 );
}

function ControlButton({
 label,
 close = false,
 onClick,
 children
}: {
 label: string;
 close?: boolean;
 onClick: () => void;
 children: ReactNode;
}) {
 return (
  <button
   type="button"
   aria-label={label}
   title={label}
   onClick={onClick}
   className={cn(
    'text-foreground/75 flex h-full w-11 items-center justify-center transition-colors outline-none',
    'hover:bg-muted hover:text-foreground active:bg-muted/70',
    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset',
    close && 'hover:bg-destructive hover:text-destructive-foreground active:bg-destructive/90'
   )}
  >
   {children}
  </button>
 );
}

const iconProps = {
 viewBox: '0 0 10 10',
 fill: 'none',
 stroke: 'currentColor',
 strokeWidth: 1.2,
 strokeLinecap: 'square',
 className: 'size-2.5',
 'aria-hidden': 'true'
} as const;

function MinimizeIcon() {
 return (
  <svg {...iconProps}>
   <path d="M1.5 5h7" />
  </svg>
 );
}

function MaximizeIcon() {
 return (
  <svg {...iconProps}>
   <rect x="1.5" y="1.5" width="7" height="7" />
  </svg>
 );
}

function RestoreIcon() {
 return (
  <svg {...iconProps}>
   <path d="M3.5 1.5h5v5" />
   <rect x="1.5" y="3.5" width="5" height="5" />
  </svg>
 );
}

function CloseIcon() {
 return (
  <svg {...iconProps}>
   <path d="M2 2l6 6M8 2l-6 6" />
  </svg>
 );
}
