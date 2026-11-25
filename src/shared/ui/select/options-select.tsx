import {TooltipLabel} from '@/shared/ui/tooltip';
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from './primitives';

export function OptionsSelect({
 id,
 value,
 onValueChange,
 options,
 label,
 disabled,
 size
}: {
 id?: string;
 value: string;
 onValueChange: (value: string) => void;
 options: readonly {value: string; label: string}[];
 label: string;
 disabled?: boolean;
 size?: 'default' | 'sm';
}) {
 // Radix reserves the empty string for clearing selection. Sombra uses it for the system default device.
 const prefix = 'value:';
 return (
  <Select
   disabled={disabled}
   value={prefix + value}
   onValueChange={next => {
    if (next.startsWith(prefix)) onValueChange(next.slice(prefix.length));
   }}
  >
   <SelectTrigger id={id} size={size} aria-label={label} className="w-full min-w-0">
    <SelectValue placeholder={label} />
   </SelectTrigger>
   <SelectContent position="popper" align="start" collisionPadding={12} className="z-[200] max-w-[calc(100vw-24px)]">
    <SelectGroup>
     {options.map(option => (
      <TooltipLabel content={option.label} key={option.value}>
       <SelectItem value={prefix + option.value}>{option.label}</SelectItem>
      </TooltipLabel>
     ))}
    </SelectGroup>
   </SelectContent>
  </Select>
 );
}
