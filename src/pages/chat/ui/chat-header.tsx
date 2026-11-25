import {TooltipLabel} from '@/shared/ui/tooltip';
import {Input} from '@/shared/ui/input';
import {
 Bot,
 MessageCircle,
 PanelRight,
 PanelRightClose,
 PanelRightOpen,
 Phone,
 Search,
 Settings,
 Users,
 Video,
 Volume2,
 X
} from 'lucide-react';
import type {RefObject} from 'react';
import {DmHeaderIdentity} from '@/entities/conversation';
import {participantCount} from '@/features/conversation-details';
import {DialogCallBanner} from '@/features/voice-room';
import type {Voice} from '@/features/voice-room';
import {Button} from '@/shared/ui/button';
import type {ChatNavigationModel} from '../model/use-chat-navigation';
import type {ChatPanelsModel} from '../model/use-chat-panels';
import type {ChatMessagesModel} from '../model/use-chat-messages';
import type {ChatCallsModel} from '../model/use-chat-calls';
import type {ChatStateModel} from '../model/use-chat-state';

type Props = {
 chat: ChatStateModel;
 nav: ChatNavigationModel;
 panels: ChatPanelsModel;
 messages: ChatMessagesModel;
 calls: ChatCallsModel;
 call: Voice;
 infoTrigger: RefObject<HTMLButtonElement | null>;
 materialsTrigger: RefObject<HTMLButtonElement | null>;
 voiceChat?: {open: boolean; toggle: () => void};
};

/** Шапка чата, уведомление об ошибке и баннер звонка в переписке. */
export function ChatHeader({
 chat,
 nav,
 panels,
 messages,
 calls,
 call,
 infoTrigger,
 materialsTrigger,
 voiceChat
}: Props) {
 const {home, channel, title, friends, peer, dmBot, typingUntil} = nav;
 const chatToggleLabel = voiceChat?.open ? 'Свернуть чат комнаты' : 'Открыть чат комнаты';
 return (
  <>
   <header className="chat-header flex shrink-0 items-center gap-2.5 border-b px-4">
    {!peer &&
     (home && channel && 'members' in channel && channel.members.length > 2 && channel.avatar ? (
      <img className="dialog-header-avatar" src={channel.avatar} alt="" />
     ) : home ? (
      <MessageCircle className="text-muted-foreground" />
     ) : messages.voiceLayout ? (
      <Volume2 className="text-muted-foreground" />
     ) : (
      <MessageCircle className="text-muted-foreground" />
     ))}
    {channel && !friends ? (
     <TooltipLabel content="Информация о чате">
      <button
       ref={infoTrigger}
       type="button"
       className={`chat-conversation-info${peer ? 'dm-header-info' : ''}`}
       aria-label="Информация о чате"
       onClick={panels.actions.openChatInfo}
      >
       {peer ? <DmHeaderIdentity user={peer} typingUntil={typingUntil} /> : <strong>{title}</strong>}
       {home && 'members' in channel && channel.members.length > 2 && (
        <small>{participantCount(channel.members.length)}</small>
       )}
      </button>
     </TooltipLabel>
    ) : (
     <strong>{title}</strong>
    )}
    <div className="header-actions ml-auto flex items-center gap-5 [&_svg]:w-5">
     {dmBot && (
      <TooltipLabel content="Управление ботом">
       <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Управление ботом"
        onClick={() => panels.actions.openBotSettings(dmBot.id)}
       >
        <Settings />
       </Button>
      </TooltipLabel>
     )}
     {home && channel && !friends && !peer?.bot && (
      <div className="dialog-call-header-actions">
       <TooltipLabel content="Начать аудиозвонок">
        <Button
         type="button"
         variant="ghost"
         size="icon-sm"
         aria-label="Начать аудиозвонок"
         disabled={calls.busy || call.busy}
         onClick={() => void calls.start(channel.id, false)}
        >
         <Phone />
        </Button>
       </TooltipLabel>
       <TooltipLabel content="Начать видеозвонок">
        <Button
         type="button"
         variant="ghost"
         size="icon-sm"
         aria-label="Начать видеозвонок"
         disabled={calls.busy || call.busy}
         onClick={() => void calls.start(channel.id, true)}
        >
         <Video />
        </Button>
       </TooltipLabel>
      </div>
     )}
     {!home && channel && (
      <TooltipLabel content="Боты комнаты">
       <button aria-label="Боты комнаты" onClick={() => panels.actions.openModal('bots')}>
        <Bot />
       </button>
      </TooltipLabel>
     )}
     {nav.canShowMembers && (
      <TooltipLabel content="Участники">
       <button
        aria-label="Участники"
        aria-pressed={panels.members && !panels.materialsOpen}
        onClick={panels.actions.toggleMembers}
       >
        <Users />
       </button>
      </TooltipLabel>
     )}
     <div className="chat-search relative">
      <Input
       className="w-[210px] pr-8"
       aria-label="Поиск сообщений"
       placeholder="Поиск сообщений"
       value={messages.search}
       onChange={event => {
        const query = event.target.value;
        if (query && voiceChat && !voiceChat.open) voiceChat.toggle();
        messages.actions.setSearch(query);
       }}
      />
      <Search
       aria-hidden="true"
       className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2"
      />
     </div>
     {voiceChat && (
      <TooltipLabel content={chatToggleLabel}>
       <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={chatToggleLabel}
        aria-controls="voice-chat"
        aria-expanded={voiceChat.open}
        onClick={voiceChat.toggle}
       >
        {voiceChat.open ? <PanelRightClose /> : <PanelRightOpen />}
       </Button>
      </TooltipLabel>
     )}
     {channel && !friends && (
      <TooltipLabel content="Фото, файлы и ссылки">
       <button
        ref={materialsTrigger}
        type="button"
        className="materials-toggle"
        aria-label="Открыть материалы переписки"
        aria-controls="conversation-materials"
        aria-expanded={panels.materialsOpen}
        onClick={panels.actions.toggleMaterials}
       >
        <PanelRight size={19} />
       </button>
      </TooltipLabel>
     )}
    </div>
   </header>
   {chat.error && (
    <div className="chat-notice flex items-center gap-3 border-b px-4 py-3 text-[13px]" role="alert">
     {chat.error}
     <a href="#login">Войти</a>
     <TooltipLabel content="Закрыть">
      <button className="ml-auto" onClick={chat.actions.clearError} aria-label="Закрыть">
       <X size={16} />
      </button>
     </TooltipLabel>
    </div>
   )}
   {calls.error && !calls.incoming && (
    <div className="chat-notice flex items-center gap-3 border-b px-4 py-3 text-[13px]" role="alert">
     {calls.error}
     <button className="ml-auto" type="button" aria-label="Закрыть ошибку звонка" onClick={calls.clearError}>
      <X size={16} />
     </button>
    </div>
   )}
   {calls.currentDialogCall && (
    <DialogCallBanner
     call={calls.currentDialogCall}
     joined={call.room === calls.currentDialogCall.id}
     busy={calls.busy || call.busy}
     onJoin={() => void calls.join(calls.currentDialogCall!)}
     onLeave={call.leave}
    />
   )}
  </>
 );
}
