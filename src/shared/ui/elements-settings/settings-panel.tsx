import {Slider} from '@/shared/ui/slider';
import {Input} from '@/shared/ui/input';
// Upstream assistant-ui Elements, MIT. Commit 076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c.
// https://github.com/assistant-ui/assistant-ui/blob/076de9eaf1b5f0f1fb6fb359c5e5d68770cae65c/packages/ui/src/components/react/assistant-ui/elements/settings-panel.tsx
//
// Sombra adaptation (colours and sizes only, plus the documented trims/extensions below):
//  * `systemPrompt`, `temperature` and `toggles` are optional. Hermes owns the system
//    prompt, the bot transport has no temperature and there are no per-bot extras, so the
//    optional sections render only when passed.
//  * An empty `models` list renders no pill row (an empty rounded field would otherwise
//    look like a broken control); the current model plus `modelInput` carries that case.
//  * `reasoning` is the one new section: the bot contract stores a reasoning level next
//    to the model (app/BOT-MODEL-SETTINGS.md). It repeats the canonical pill row markup
//    verbatim, including `aria-pressed`, `field`, `bg-background` for the selection.
//  * `modelInput` is the canonical field the dialog needs when the provider publishes no
//    catalogue: the current identifier in a validated text input.
//  * `disabled` marks an in-flight save (no optimistic saving); `modelLabel` names the
//    "" (provider default) pill. Labels are Russian because the panel lives in a
//    Russian dialog; the mono label style is the canonical one.
//  * `max-w-sm` is dropped so the card fills the bot settings body.
import {useId} from 'react';
import type {ComponentProps, ReactNode} from 'react';
import {cn} from '@/shared/lib/utils';
import {Switch} from '../switch';
import {Textarea} from '../textarea';
import {field, mono, paper} from './surfaces';
import {clamp} from './range';

export interface SettingToggle {
 key: string;
 label: string;
 detail: string;
 on: boolean;
}

export interface SettingsPanelReasoning {
 value: string;
 options: readonly {value: string; label: string}[];
 onChange?: (value: string) => void;
}

export interface SettingsPanelModelInput {
 value: string;
 onChange: (value: string) => void;
 invalid?: boolean;
 hint?: ReactNode;
}

export function SettingsPanel({
 model,
 models,
 systemPrompt,
 temperature,
 toggles,
 onModelChange,
 onSystemPromptChange,
 onTemperatureChange,
 onToggle,
 reasoning,
 modelInput,
 modelLabel,
 disabled = false,
 className,
 ...props
}: Omit<
 ComponentProps<'div'>,
 | 'children'
 | 'model'
 | 'models'
 | 'systemPrompt'
 | 'temperature'
 | 'toggles'
 | 'onModelChange'
 | 'onSystemPromptChange'
 | 'onTemperatureChange'
 | 'onToggle'
> & {
 model: string;
 models: readonly string[];
 systemPrompt?: string | undefined;
 temperature?: number | undefined;
 toggles?: readonly SettingToggle[] | undefined;
 onModelChange?: ((model: string) => void) | undefined;
 onSystemPromptChange?: ((prompt: string) => void) | undefined;
 onTemperatureChange?: ((temperature: number) => void) | undefined;
 onToggle?: ((key: string) => void) | undefined;
 reasoning?: SettingsPanelReasoning | undefined;
 modelInput?: SettingsPanelModelInput | undefined;
 modelLabel?: ((model: string) => string) | undefined;
 disabled?: boolean | undefined;
}) {
 const inputId = useId();
 const hintId = useId();
 const label = modelLabel ?? ((value: string) => value);
 return (
  <div
   data-slot="settings-panel"
   className={cn(paper, 'flex w-full flex-col gap-4 rounded-[20px] p-4', className)}
   {...props}
  >
   {models.length > 0 ? (
    <div className="flex flex-col gap-1.5">
     <span className={cn(mono, 'text-muted-foreground')}>модель</span>
     <div className={cn(field, 'flex gap-0.5 rounded-full p-0.5')}>
      {models.map(option => {
       const className = cn(
        'flex-1 truncate rounded-full py-1 text-xs font-medium transition-[background-color,color,scale] duration-150',
        onModelChange && !disabled && 'active:scale-[0.97]',
        option === model
         ? 'bg-background text-foreground/90'
         : onModelChange
           ? 'text-muted-foreground hover:text-foreground/70'
           : 'text-muted-foreground'
       );

       return onModelChange ? (
        <button
         key={option}
         type="button"
         aria-pressed={option === model}
         disabled={disabled}
         onClick={() => onModelChange(option)}
         className={className}
        >
         {label(option)}
        </button>
       ) : (
        <span key={option} aria-current={option === model ? 'true' : undefined} className={className}>
         {label(option)}
        </span>
       );
      })}
     </div>
    </div>
   ) : null}

   {reasoning ? (
    <div className="flex flex-col gap-1.5">
     <span className={cn(mono, 'text-muted-foreground')}>уровень размышления</span>
     <div className={cn(field, 'flex gap-0.5 rounded-full p-0.5')}>
      {reasoning.options.map(option => {
       const className = cn(
        'flex-1 truncate rounded-full py-1 text-xs font-medium transition-[background-color,color,scale] duration-150',
        reasoning.onChange && !disabled && 'active:scale-[0.97]',
        option.value === reasoning.value
         ? 'bg-background text-foreground/90'
         : reasoning.onChange
           ? 'text-muted-foreground hover:text-foreground/70'
           : 'text-muted-foreground'
       );

       return reasoning.onChange ? (
        <button
         key={option.value}
         type="button"
         aria-pressed={option.value === reasoning.value}
         disabled={disabled}
         onClick={() => reasoning.onChange?.(option.value)}
         className={className}
        >
         {option.label}
        </button>
       ) : (
        <span
         key={option.value}
         aria-current={option.value === reasoning.value ? 'true' : undefined}
         className={className}
        >
         {option.label}
        </span>
       );
      })}
     </div>
    </div>
   ) : null}

   {modelInput ? (
    <div className="flex flex-col gap-1.5">
     <label htmlFor={inputId} className={cn(mono, 'text-muted-foreground')}>
      идентификатор модели
     </label>
     <Input
      id={inputId}
      value={modelInput.value}
      disabled={disabled}
      aria-invalid={modelInput.invalid || undefined}
      aria-describedby={modelInput.hint ? hintId : undefined}
      onChange={event => modelInput.onChange(event.target.value)}
      className={cn(
       field,
       'text-foreground/80 focus-visible:ring-foreground/20 w-full rounded-xl px-3 py-2 text-xs leading-relaxed outline-none focus-visible:ring-1',
       modelInput.invalid && 'ring-1 ring-red-600/60 dark:ring-red-400/60'
      )}
     />
     {modelInput.hint ? (
      <span
       id={hintId}
       className={cn(
        'text-[11px] leading-relaxed',
        modelInput.invalid ? 'text-red-600/80 dark:text-red-400/80' : 'text-muted-foreground'
       )}
      >
       {modelInput.hint}
      </span>
     ) : null}
    </div>
   ) : null}

   {systemPrompt !== undefined ? (
    <div className="flex flex-col gap-1.5">
     <span className={cn(mono, 'text-muted-foreground')}>system prompt</span>
     <Textarea
      value={systemPrompt}
      onChange={event => onSystemPromptChange?.(event.target.value)}
      rows={3}
      aria-label="System prompt"
      className="resize-none"
     />
    </div>
   ) : null}

   {temperature !== undefined ? (
    <div className="flex flex-col gap-1.5">
     <span className="flex items-baseline justify-between">
      <span className={cn(mono, 'text-muted-foreground')}>temperature</span>
      <span className={cn(mono, 'text-muted-foreground tabular-nums')}>{clamp(temperature, 0, 2).toFixed(1)}</span>
     </span>
     <Slider
      min={0}
      max={2}
      step={0.1}
      value={[clamp(temperature, 0, 2)]}
      aria-label="Temperature"
      onValueChange={([value]) => onTemperatureChange?.(value)}
      className="h-6"
     />
    </div>
   ) : null}

   {toggles && toggles.length > 0 ? (
    <div className="flex flex-col gap-2.5">
     {toggles.map(toggle => (
      <div key={toggle.key} className="flex items-center gap-3">
       <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px]">{toggle.label}</span>
        <span className="text-muted-foreground truncate text-xs">{toggle.detail}</span>
       </span>
       <Switch
        checked={toggle.on}
        aria-label={toggle.label}
        disabled={disabled || !onToggle}
        onCheckedChange={() => onToggle?.(toggle.key)}
       />{' '}
      </div>
     ))}
    </div>
   ) : null}
  </div>
 );
}
