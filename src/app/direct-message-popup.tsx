import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import '@fontsource-variable/geist';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { DirectMessageToast, type DirectMessage } from '@/features/notifications/index.popup';
import {validNotificationTarget} from '@/features/notifications/index.popup';
import { ErrorBoundary } from '@/app/providers/ErrorBoundary';

const container = document.getElementById('notifications')!;
const root = createRoot(container);
const messages = new Map<number, { message: DirectMessage; timer: number }>();
let nextId = 0;

function render() {
  flushSync(() => {
    root.render([...messages].map(([id, { message }]) => (
      // Сломанное уведомление не должно гасить остальные: падает только его карточка.
      <ErrorBoundary key={id} fallback={() => null}>
       <DirectMessageToast {...message} onOpen={validNotificationTarget(message.target)?()=>{
        const target=message.target!;remove(id);render();
        void invoke('activate_message_notification',{target}).catch(console.error);
       }:undefined} onClose={() => {
        remove(id);
        render();
       }} />
      </ErrorBoundary>
    )));
  });
  const height = messages.size ? Math.ceil(container.getBoundingClientRect().height) : 0;
  void invoke('resize_notification_popup', { height }).catch(console.error);
}

function remove(id: number) {
  const notification = messages.get(id);
  if (!notification) return;
  window.clearTimeout(notification.timer);
  messages.delete(id);
}

document.addEventListener('contextmenu', (event) => event.preventDefault());

await getCurrentWebviewWindow().listen<DirectMessage>('direct-message-popup', ({ payload }) => {
  if (messages.size >= 3) remove(messages.keys().next().value!);
  const id = nextId++;
  const timer = window.setTimeout(() => {
    remove(id);
    render();
  }, 5500);
  messages.set(id, { message: payload, timer });
  render();
});
await invoke('notification_popup_ready');
