import { Select as Primitive } from 'radix-ui';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import './select.css';

type Option = {value: string; label: string};
// Prefix values so the default device's empty ID remains a selectable item.
export function Select({id,value,onValueChange,options,label}: {id?:string;value:string;onValueChange:(value:string)=>void;options:Option[];label:string}) {
 return <Primitive.Root value={`value:${value}`} onValueChange={next=>onValueChange(next.slice(6))}>
  <Primitive.Trigger id={id} data-slot="select-trigger" aria-label={label}><Primitive.Value/><Primitive.Icon><ChevronDown size={16}/></Primitive.Icon></Primitive.Trigger>
  <Primitive.Portal><Primitive.Content data-slot="select-content" position="popper" sideOffset={6} collisionPadding={12}>
   <Primitive.ScrollUpButton className="select-scroll"><ChevronUp size={16}/></Primitive.ScrollUpButton>
   <Primitive.Viewport className="select-viewport">{options.map(option=><Primitive.Item key={option.value} value={`value:${option.value}`} data-slot="select-item" title={option.label}><Primitive.ItemText>{option.label}</Primitive.ItemText><Primitive.ItemIndicator className="select-check"><Check size={16}/></Primitive.ItemIndicator></Primitive.Item>)}</Primitive.Viewport>
   <Primitive.ScrollDownButton className="select-scroll"><ChevronDown size={16}/></Primitive.ScrollDownButton>
  </Primitive.Content></Primitive.Portal>
 </Primitive.Root>;
}
