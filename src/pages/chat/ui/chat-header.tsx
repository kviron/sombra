import {Bot, MessageCircle, PanelRight, Phone, Search, Settings, Users, Video, Volume2, X} from 'lucide-react';
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
};

/** Шапка чата, уведомление об ошибке и баннер звонка в переписке. */
export function ChatHeader({chat, nav, panels, messages, calls, call, infoTrigger, materialsTrigger}: Props) {
 const {home, channel, title, friends, peer, dmBot, typingUntil} = nav;
 return (
  <>
   <header className="chat-header flex h-[50px] shrink-0 items-center gap-2.5 border-b px-4">
    {!peer &&
     (home && channel && 'members' in channel && channel.members.length > 2 && channel.avatar ? (
      <img className="dialog-header-avatar" src={channel.avatar} alt="" />
     ) : home ? (
      <MessageCircle className="text-[#808089]" />
     ) : messages.voiceLayout ? (
      <Volume2 className="text-[#808089]" />
     ) : (
      <MessageCircle className="text-[#808089]" />
     ))}
    {channel && !friends ? (
     <button
      ref={infoTrigger}
      type="button"
      className={`chat-conversation-info${peer ? 'dm-header-info' : ''}`}
      aria-label="Информация о чате"
      title="Информация о чате"
      onClick={panels.actions.openChatInfo}
     >
      {peer ? <DmHeaderIdentity user={peer} typingUntil={typingUntil} /> : <strong>{title}</strong>}
      {home && 'members' in channel && channel.members.length > 2 && (
       <small>{participantCount(channel.members.length)}</small>
      )}
     </button>
    ) : (
     <strong>{title}</strong>
    )}
    <div className="header-actions ml-auto flex items-center gap-5 [&_svg]:w-5">
     {dmBot && (
      <Button
       type="button"
       variant="ghost"
       size="icon-sm"
       title="Управление ботом"
       aria-label="Управление ботом"
       onClick={() => panels.actions.openBotSettings(dmBot.id)}
      >
       <Settings />
      </Button>
     )}
     {home && channel && !friends && !peer?.bot && (
      <div className="dialog-call-header-actions">
       <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Начать аудиозвонок"
        aria-label="Начать аудиозвонок"
        disabled={calls.busy || call.busy}
        onClick={() => void calls.start(channel.id, false)}
       >
        <Phone />
       </Button>
       <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Начать видеозвонок"
        aria-label="Начать видеозвонок"
        disabled={calls.busy || call.busy}
        onClick={() => void calls.start(channel.id, true)}
       >
        <Video />
       </Button>
      </div>
     )}
     {!home && channel && (
      <button title="Боты комнаты" onClick={() => panels.actions.openModal('bots')}>
       <Bot />
      </button>
     )}
     {nav.canShowMembers && (
      <button
       title="Участники"
       aria-pressed={panels.members && !panels.materialsOpen}
       onClick={panels.actions.toggleMembers}
      >
       <Users />
      </button>
     )}
     <label className="chat-search">
      <input
       className="w-[210px] text-[13px] outline-none [background:none]"
       aria-label="Поиск сообщений"
       placeholder="Поиск сообщений"
       value={messages.search}
       onChange={event => messages.actions.setSearch(event.target.value)}
      />
      <Search size={17} />
     </label>
     {channel && !friends && (
      <button
       ref={materialsTrigger}
       type="button"
       className="materials-toggle"
       aria-label="Открыть материалы переписки"
       title="Фото, файлы и ссылки"
       aria-controls="conversation-materials"
       aria-expanded={panels.materialsOpen}
       onClick={panels.actions.toggleMaterials}
      >
       <PanelRight size={19} />
      </button>
     )}
    </div>
   </header>
   {chat.error && (
    <div className="chat-notice flex items-center gap-3 border-b px-4 py-3 text-[13px]" role="alert">
     {chat.error}
     <a href="#login">Войти</a>
     <button className="ml-auto" onClick={chat.actions.clearError} title="Закрыть">
      <X size={16} />
     </button>
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
