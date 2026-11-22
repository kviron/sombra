import { X } from 'lucide-react';
import './direct-message-notifications.css';
import type {NotificationTarget} from '../model/notification-target';

export type DirectMessage = {
  sender: string;
  text: string;
  avatar?: string | null;
  target?: NotificationTarget;
};

export function DirectMessageToast({ sender, text, avatar, onClose, onOpen }: DirectMessage & { onClose: () => void; onOpen?: () => void }) {
  const localAvatar = avatar && /^data:image\/(?:png|jpeg|webp);base64,/.test(avatar) ? avatar : undefined;

  return (
    <article className="direct-message-toast">
      <span className="direct-message-toast-avatar" aria-hidden="true">
        {localAvatar ? <img src={localAvatar} alt="" /> : [...sender][0]}
      </span>
      <div>
        <strong>{sender}</strong>
        <p>{text}</p>
      </div>
      {onOpen&&<button type="button" className="direct-message-open" aria-label={`Открыть чат: ${sender}`} onClick={onOpen}/>}
      <button type="button" aria-label="Закрыть уведомление" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </button>
    </article>
  );
}
