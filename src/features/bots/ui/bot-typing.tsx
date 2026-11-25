import type {ChatState} from '@/shared/types';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {Message, MessageAvatar, MessageContent, MessageHeader} from '@/shared/ui/message';
import {Bubble, BubbleContent} from '@/shared/ui/sombra-bubble';
import {ImageGeneration, JobProgress, TypingIndicator} from '@/shared/ui/elements-progress';
import {useBotImageActivity, useBotTyping} from '../model/use-bot-typing';
import './bot-typing.css';

/**
 * A single pinned activity row above the composer:
 *  * the official Elements TypingIndicator plus the bot avatar (item 3),
 *  * the compact Elements JobProgress line with the bot's `status` (or the label mapped
 *    from its `activity` code) when present, otherwise the neutral "работает…" and the
 *    elapsed time measured from `started_at` (item 4).
 * The row is keyed to its bot and channel, so foreign messages never move it and it
 * disappears as soon as the typing window expires, the bot replies, an error drops the
 * entry, or the conversation changes. Parse and expiry live in the model of the slice.
 */
export function BotTyping({state, channel}: {state: ChatState; channel: string}) {
 const typing = useBotTyping({state, channel});
 if (!typing) return null;
 return (
  <div
   className="bot-typing flex max-w-full min-w-0 flex-none flex-col items-start gap-1.5 px-0.5 max-[760px]:gap-1"
   role="status"
   aria-live="polite"
   aria-atomic="false"
  >
   {/* Скрытая подпись: sr-only плюс border-current вместо прежнего border: 0. */}
   <span className="sr-only border-current">{typing.announcement}</span>
   <JobProgress
    title={typing.name}
    stage={typing.stage}
    detail={typing.detail || undefined}
    startedAt={typing.startedAt}
   />
   {/* The live region above owns the announcement; the animated dots stay decorative. */}
   <span className="flex max-w-full min-w-0 items-end gap-2" aria-hidden="true">
    {typing.user ? (
     <UserAvatar user={typing.user} size="sm" presence={false} decorative className="mb-px shrink-0" />
    ) : null}
    <TypingIndicator variant="bubble" label={typing.announcement} />
   </span>
  </div>
 );
}

/**
 * The "not yet arrived" message at the end of the transcript while the bot in this
 * channel reports `activity: "image"`. It is the vendored Elements ImageGeneration card
 * inside the normal message composition, so it lines up with the pictures that replace
 * it. It lives only as long as the live `botTyping` entry:
 *  * a real image message from the same bot in the same channel hides it immediately
 *    (no waiting for the next poll, no duplicate card next to the delivered picture),
 *  * an expired window, a dropped entry or a different conversation removes it,
 *  * it never invents a prompt, a resolution or a percentage — the only text is the
 *    worker's `status` (or «Генерирую изображение…»),
 *  * if the reader was at the bottom the transcript follows it; a person reading further
 *    up is not pulled down.
 */
export function BotImageActivity({state, channel}: {state: ChatState; channel: string}) {
 const image = useBotImageActivity({state, channel});
 if (!image) return null;
 return (
  <div className="bot-image-activity flex max-w-full min-w-0 flex-col" data-bot-image-activity={image.bot}>
   <Message
    className="chat-message bot-image-message static w-auto shrink-0 text-inherit"
    align="start"
    aria-label={`${image.name}: ${image.label}`}
   >
    <MessageAvatar className="message-avatar text-primary min-w-0 translate-none! place-items-center bg-transparent text-[12px]">
     {image.user ? <UserAvatar user={image.user} size="md" presence={false} decorative /> : image.name[0]}
    </MessageAvatar>
    <MessageContent className="message-content block w-auto wrap-normal">
     <MessageHeader className="message-meta">
      <strong>{image.name}</strong>
      <small className="bot-badge text-primary rounded-[4px] px-[5px] py-px text-[9px]">БОТ</small>
     </MessageHeader>
     <Bubble data-image-message="true">
      <BubbleContent>
       <ImageGeneration prompt={image.label} generating />
      </BubbleContent>
     </Bubble>
    </MessageContent>
   </Message>
  </div>
 );
}
