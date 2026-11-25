import {tauri} from '@/shared/api';
import '@/app/styles/index.css';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {
 DirectMessageToast,
 MESSAGE_NOTIFICATION_DURATION_MS,
 validNotificationTarget,
 type DirectMessage
} from '@/features/notifications/index.popup';
import {ErrorBoundary} from '@/app/providers/ErrorBoundary';
import {applyTheme} from '@/app/providers/ThemeProvider';

const container = document.getElementById('notifications')!;
const root = createRoot(container);
const messages = new Map<number, {message: DirectMessage; timer: number}>();
let nextId = 0;

function render() {
 applyTheme();
 flushSync(() => {
  root.render(
   [...messages].map(([id, {message}]) => (
    // Сломанное уведомление не должно гасить остальные: падает только его карточка.
    <ErrorBoundary key={id} fallback={() => null}>
     <DirectMessageToast
      {...message}
      onOpen={
       validNotificationTarget(message.target)
        ? () => {
           const target = message.target!;
           remove(id);
           render();
           void tauri.commands.notifications.activate(target).catch(console.error);
          }
        : undefined
      }
      onClose={() => {
       remove(id);
       render();
      }}
     />
    </ErrorBoundary>
   ))
  );
 });
 const height = messages.size ? Math.ceil(container.getBoundingClientRect().height) : 0;
 void tauri.commands.notifications.resizePopup(height).catch(console.error);
}

function remove(id: number) {
 const notification = messages.get(id);
 if (!notification) return;
 window.clearTimeout(notification.timer);
 messages.delete(id);
}

document.addEventListener('contextmenu', event => event.preventDefault());

await tauri.events.listenCurrentWindow<DirectMessage>('direct-message-popup', payload => {
 if (messages.size >= 3) remove(messages.keys().next().value!);
 const id = nextId++;
 const timer = window.setTimeout(() => {
  remove(id);
  render();
 }, MESSAGE_NOTIFICATION_DURATION_MS);
 messages.set(id, {message: payload, timer});
 render();
});
await tauri.commands.notifications.popupReady();
