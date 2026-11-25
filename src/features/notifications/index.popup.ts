// Entry point for the notifications popup window.
// The popup renders one toast and nothing else, so it must not pull the whole slice
// (and its styles) into its bundle.
export {DirectMessageToast, type DirectMessage} from './ui/direct-message-toast';
export {validNotificationTarget} from './model/notification-target';
export {MESSAGE_NOTIFICATION_DURATION_MS} from './model/notification-duration';
