import {X} from 'lucide-react';
import {Button} from '@/shared/ui/button';
import {Card, CardDescription, CardTitle} from '@/shared/ui/card';
import './direct-message-notifications.css';
import type {NotificationTarget} from '../model/notification-target';

export type DirectMessage = {
 sender: string;
 text: string;
 avatar?: string | null;
 target?: NotificationTarget;
};

export function DirectMessageToast({
 sender,
 text,
 avatar,
 onClose,
 onOpen
}: DirectMessage & {onClose: () => void; onOpen?: () => void}) {
 const localAvatar = avatar && /^data:image\/(?:png|jpeg|webp);base64,/.test(avatar) ? avatar : undefined;

 return (
  <Card
   role="article"
   size="sm"
   className="direct-message-toast relative grid w-[min(322px,calc(100vw-32px))] grid-cols-[48px_minmax(0,1fr)_24px] items-start gap-2.5 p-2.5"
  >
   <span
    className="bg-muted grid size-12 place-items-center overflow-hidden rounded-full font-semibold"
    aria-hidden="true"
   >
    {localAvatar ? <img className="size-full object-cover" src={localAvatar} alt="" /> : [...sender][0]}
   </span>
   <div className="min-w-0">
    <CardTitle className="truncate">{sender}</CardTitle>
    <CardDescription className="mt-1 line-clamp-2 text-xs [overflow-wrap:anywhere]">{text}</CardDescription>
   </div>
   {onOpen && (
    <Button
     type="button"
     variant="ghost"
     className="absolute inset-y-1 right-9 left-1 h-auto hover:bg-transparent dark:hover:bg-transparent"
     aria-label={`Открыть чат: ${sender}`}
     onClick={onOpen}
    />
   )}
   <Button type="button" variant="ghost" size="icon-xs" aria-label="Закрыть уведомление" onClick={onClose}>
    <X aria-hidden="true" />
   </Button>
  </Card>
 );
}
