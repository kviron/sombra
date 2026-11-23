import {Select as Primitive} from 'radix-ui';
import {Check, ChevronDown, ChevronUp} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import './menu-material.css';

type Option = {value: string; label: string};
// Prefix values so the default device's empty ID remains a selectable item.
export function Select({
 id,
 value,
 onValueChange,
 options,
 label,
 disabled
}: {
 id?: string;
 value: string;
 onValueChange: (value: string) => void;
 options: Option[];
 label: string;
 disabled?: boolean;
}) {
 return (
  <Primitive.Root disabled={disabled} value={`value:${value}`} onValueChange={next => onValueChange(next.slice(6))}>
   <Primitive.Trigger
    id={id}
    data-slot="select-trigger"
    aria-label={label}
    className={cn(
     'flex min-h-10 w-full min-w-0 items-center justify-between gap-3 rounded-[8px] border',
     'border-[var(--surface-border,#e1ebff21)] bg-[#dce6fa09] px-3 py-2 text-left text-[13px] text-[#e1e4ec]',
     'hover:bg-[#dce6fa14] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8fa9d4]',
     '[&>span:first-child]:truncate [&>span:last-child]:shrink-0 [&>span:last-child]:text-[#aeb8c9]'
    )}
   >
    <Primitive.Value />
    <Primitive.Icon>
     <ChevronDown size={16} />
    </Primitive.Icon>
   </Primitive.Trigger>
   <Primitive.Portal>
    <Primitive.Content
     className={cn(
      'sombra-menu-surface',
      'z-[200] max-h-[min(300px,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)]',
      'max-w-[calc(100vw_-_24px)] overflow-hidden'
     )}
     data-slot="select-content"
     position="popper"
     sideOffset={6}
     collisionPadding={12}
    >
     <Primitive.ScrollUpButton className="flex justify-center p-1 text-[#aeb8c9]">
      <ChevronUp size={16} />
     </Primitive.ScrollUpButton>
     <Primitive.Viewport className="p-[5px]">
      {options.map(option => (
       <Primitive.Item
        key={option.value}
        value={`value:${option.value}`}
        data-slot="select-item"
        title={option.label}
        className={cn(
         'relative flex min-h-9 cursor-pointer items-center rounded-md py-2 pr-[34px] pl-2.5',
         'text-[13px] leading-5 [overflow-wrap:anywhere] outline-none select-none'
        )}
       >
        <Primitive.ItemText>{option.label}</Primitive.ItemText>
        <Primitive.ItemIndicator className="absolute right-2.5 flex">
         <Check size={16} />
        </Primitive.ItemIndicator>
       </Primitive.Item>
      ))}
     </Primitive.Viewport>
     <Primitive.ScrollDownButton className="flex justify-center p-1 text-[#aeb8c9]">
      <ChevronDown size={16} />
     </Primitive.ScrollDownButton>
    </Primitive.Content>
   </Primitive.Portal>
  </Primitive.Root>
 );
}
