import {TooltipLabel} from '@/shared/ui/tooltip';
import type {RefObject} from 'react';
import {ArrowUp} from 'lucide-react';
import {ComposerSendButton} from '@/shared/ui/elements-composer';
import {MotionIcon} from '@/shared/ui/motion-icon';
import {Textarea} from '@/shared/ui/textarea';
import {BotTyping} from '@/features/bots';
import {ReferenceDraft} from '@/features/message-actions';
import {
 AttachmentComposer,
 AttachmentDraftPreview,
 AssistantComposer,
 ExpressionPicker,
 StickerSuggestions,
 pastedAttachments
} from '@/features/message-composer';
import type {ChatState} from '@/shared/types';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatPanelsModel} from '../model/use-chat-panels';
import type {ChatMessagesModel} from '../model/use-chat-messages';
import type {ChatStateModel} from '../model/use-chat-state';

type Props = {
 chat: ChatStateModel;
 state: ChatState | null;
 nav: ChatNavigationModel;
 panels: ChatPanelsModel;
 messages: ChatMessagesModel;
 composerRef: RefObject<HTMLDivElement | null>;
 forwardCommentRef: RefObject<HTMLTextAreaElement | null>;
};

/** Поле ввода: ответ, пересылка, вложения, стикеры, упоминания и подсказки. */
export function ChatComposer({chat, state, nav, panels, messages, composerRef, forwardCommentRef}: Props) {
 const {home, channel, group, title} = nav;
 const {draft, replyDraft, forwardDraft, attachments} = messages;
 const meId = state?.me.id || '';
 const busy = chat.busy;
 const focusComposer = () => requestAnimationFrame(() => messages.textareaRef.current?.focus());

 return (
  channel && (
   <div className="composer-chrome" ref={composerRef}>
    {state && !messages.voiceLayout && !messages.imageActivityVisible && (
     <BotTyping state={state} channel={channel.id} />
    )}
    {forwardDraft ? (
     <>
      <ReferenceDraft
       kind="forward"
       message={forwardDraft.message}
       author={nav.userName(forwardDraft.message.user)}
       disabled={busy}
       onCancel={() => {
        messages.actions.cancelForward();
        focusComposer();
       }}
      />
      <form
       className="forward-composer"
       onSubmit={event => {
        event.preventDefault();
        void messages.actions.sendForward();
       }}
      >
       <Textarea
        ref={forwardCommentRef}
        aria-label="Комментарий к пересылке"
        placeholder="Добавить комментарий (необязательно)"
        rows={1}
        maxLength={2000}
        disabled={busy}
        value={forwardDraft.comment}
        onChange={event => messages.actions.setForwardComment(event.target.value)}
        onKeyDown={event => {
         if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
         }
        }}
       />
       <TooltipLabel content="Отправить пересылку">
        <ComposerSendButton type="submit" disabled={busy} aria-label="Отправить пересылку">
         <MotionIcon icon={ArrowUp} kind="send" size={16} />
        </ComposerSendButton>
       </TooltipLabel>
      </form>
     </>
    ) : (
     <>
      {replyDraft && (
       <ReferenceDraft
        kind="reply"
        message={replyDraft}
        author={nav.userName(replyDraft.user)}
        disabled={busy}
        onCancel={messages.actions.cancelReply}
       />
      )}
      <AssistantComposer
       onMentionInserted={messages.actions.insertMention}
       key={`${meId}:${channel.id}`}
       state={state!}
       channel={channel.id}
       group={home ? undefined : group?.id}
       draft={draft}
       setDraft={messages.actions.setDraft}
       onSubmit={event => {
        event.preventDefault();
        void messages.actions.send();
       }}
       onSearch={() => document.querySelector<HTMLInputElement>('.chat-search input')?.focus()}
       disabled={!channel}
       sendDisabled={messages.sendDisabled}
       attachments={
        <AttachmentDraftPreview
         key={`${meId}:${channel.id}`}
         attachments={attachments}
         disabled={busy}
         onRemove={messages.actions.removeAttachment}
        />
       }
       hasAttachment={attachments.length > 0}
       placeholder={`Написать в ${title}`}
       textareaRef={messages.textareaRef}
       onPaste={event => {
        messages.actions.selectAttachments(pastedAttachments(event));
       }}
       sendButton={
        <TooltipLabel content="Отправить сообщение">
         <ComposerSendButton type="submit" aria-label="Отправить сообщение" disabled={messages.sendDisabled}>
          <MotionIcon icon={ArrowUp} kind="send" size={16} />
         </ComposerSendButton>
        </TooltipLabel>
       }
       leadingActions={<AttachmentComposer disabled={busy} onFiles={messages.actions.selectAttachments} />}
       suggestions={
        state && (
         <StickerSuggestions
          draft={draft}
          stickers={state.stickers}
          user={state.me.id}
          group={home ? undefined : group?.id}
          busy={busy}
          onSelect={messages.actions.sendStickerSuggestion}
         />
        )
       }
       trailingActions={
        state && (
         <ExpressionPicker
          state={state}
          refresh={chat.actions.refresh}
          onError={chat.actions.setError}
          disabled={busy}
          group={home ? undefined : group}
          onManage={panels.actions.manageStickers}
          onEmoji={emoji => messages.actions.setDraft(draft + emoji)}
          onSticker={async sticker => {
           if (!(await messages.actions.sendStickerSuggestion(sticker, false)))
            throw new Error('Не удалось отправить стикер');
          }}
         />
        )
       }
      />
     </>
    )}
   </div>
  )
 );
}
