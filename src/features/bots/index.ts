// Public API of the `features/bots` slice.
export * from './model/services/bot-service';
// Разбор активности бота нужен странице: по нему транскрипт и композер выбирают одно живое состояние.
export {hasLiveImageActivity, typingBotNames} from './model/bot-typing-rules';
export * from './ui/bot-command-suggestions';
export * from './ui/bot-settings-dialog';
export * from './ui/bot-tool-access';
export * from './ui/bot-typing';
