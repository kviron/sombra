// assistant-ui Elements (MIT), canonical geometry and surface tokens; see LICENSE.
export {
 Composer,
 ComposerBar,
 ComposerAttachments,
 ComposerAttachmentChip,
 ComposerToolbar,
 ComposerActions
} from './composer';
export {paper, ghostButton, inkButton} from './surfaces';
import type {ComponentProps} from 'react';
import {cn} from '@/shared/lib/utils';
import {ghostButton, inkButton} from './surfaces';
/** Native Sombra actions use the same upstream ComposerAttachButton surface. */
export function ComposerIconButton({className, ...props}: ComponentProps<'button'>) {
 return (
  <button
   type="button"
   className={cn(ghostButton, 'size-8 disabled:pointer-events-none disabled:opacity-30', className)}
   {...props}
  />
 );
}
export function ComposerSendButton({className, ...props}: ComponentProps<'button'>) {
 return (
  <button
   type="submit"
   data-slot="composer-send"
   className={cn('grid size-8 place-items-center rounded-full', inkButton, className)}
   {...props}
  />
 );
}
export const composerInputClass =
 'placeholder:text-muted-foreground min-h-11 w-full bg-transparent px-3 text-[15px] caret-blue-500 outline-none dark:caret-blue-400';
