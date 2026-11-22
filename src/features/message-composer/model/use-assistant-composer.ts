import {
 useEffect,
 useMemo,
 useRef,
 type ClipboardEvent,
 type FormEvent,
 type KeyboardEvent as ReactKeyboardEvent,
 type ReactNode,
 type RefObject
} from 'react';
import {useExternalStoreRuntime} from '@assistant-ui/react';
import type {ChatState} from '@/shared/types';
import {parseMusicCommand} from '@/shared/lib/music-command';
import {commandCandidates, composerTrigger, localCommandCandidates, mentionCandidates} from './composer-candidates';
import {
 insertedMention,
 localCommand,
 musicCommandsFor,
 musicEnterPressed,
 roomMusicEnabled,
 withoutLeadingSpace
} from './assistant-composer-rules';
import {formatter, suggestionAdapter, threadMessages} from './assistant-composer';

export type AssistantComposerProps = {
 onMentionInserted?: (mention: {userId: string; start: number; end: number}, text: string) => void;
 state: ChatState;
 channel: string;
 group?: string;
 draft: string;
 setDraft: (text: string) => void;
 onSubmit: (event: FormEvent) => void;
 onSearch: () => void;
 disabled: boolean;
 sendDisabled: boolean;
 hasAttachment: boolean;
 placeholder: string;
 textareaRef: RefObject<HTMLTextAreaElement | null>;
 onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
 children: ReactNode;
 attachments?: ReactNode;
 sendButton: ReactNode;
};

/**
 * Единственное место, где живёт логика поля помощника: синхронизация текста с рантаймом,
 * подсказки, вставка упоминаний и музыкальные команды. Компонент только раскладывает разметку.
 *
 * UI-рантайм внешнего хранилища ничего не отправляет: Sombra владеет черновиками,
 * вложениями и всеми сообщениями. Root перехватывает preventDefault, поэтому
 * оптимистичный сброс поля в runtime.send() не теряет черновик после ошибки сервера.
 */
export function useAssistantComposer(props: AssistantComposerProps) {
 const latest = useRef(props);
 latest.current = props;
 const runtime = useExternalStoreRuntime({
  messages: threadMessages,
  isDisabled: props.disabled,
  isSendDisabled: props.sendDisabled,
  onNew: async () => {
   throw new Error('Sombra owns message submission');
  }
 });
 const syncing = useRef(false);
 const pendingMention = useRef<{start: number; token: string} | null>(null);
 const mentionFormatter = useMemo(
  () => ({
   ...formatter,
   serialize: (item: {metadata?: Readonly<Record<string, unknown>>}) => {
    const input = latest.current.textareaRef.current,
     token = String(item.metadata?.insert || '');
    const trigger = input ? composerTrigger(input.value, '@', input.selectionStart) : null;
    pendingMention.current = trigger ? {start: trigger.offset, token} : null;
    return token;
   }
  }),
  []
 );

 // Текст поля — источник правды: черновик приходит сверху, рантайм только отражает его.
 useEffect(() => {
  syncing.current = true;
  runtime.thread.composer.setText(props.draft);
  syncing.current = false;
 }, [runtime, props.draft]);

 // Правка в рантайме возвращается в черновик, но не переписывает его тем же значением.
 useEffect(
  () =>
   runtime.thread.composer.subscribe(() => {
    if (syncing.current) return;
    const text = runtime.thread.composer.getState().text;
    if (text !== latest.current.draft) latest.current.setDraft(text);
   }),
  [runtime]
 );

 const mentions = useMemo(
  () => mentionCandidates(props.state, props.channel, props.group),
  [props.state, props.channel, props.group]
 );
 const roomMusic = roomMusicEnabled(props.state.groups, props.group, props.channel);
 const commands = useMemo(
  () => [
   ...musicCommandsFor(roomMusic),
   ...localCommandCandidates,
   ...commandCandidates(props.state, props.channel, props.group)
  ],
  [roomMusic, props.state, props.channel, props.group]
 );
 const enabled = !props.disabled && !props.sendDisabled;
 const mentionAdapter = useMemo(() => suggestionAdapter(mentions, enabled), [mentions, enabled]);
 const commandAdapter = useMemo(() => suggestionAdapter(commands, enabled), [commands, enabled]);

 /** Enter в голосовой комнате отправляет музыкальную команду, а не обычный текст. */
 function keyDownCapture(event: ReactKeyboardEvent<HTMLFormElement>) {
  if (event.target !== props.textareaRef.current) return;
  if (
   !musicEnterPressed({
    roomMusic,
    enabled,
    key: event.key,
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
    composing: event.nativeEvent.isComposing,
    keyCode: event.keyCode
   })
  )
   return;
  const command = parseMusicCommand(props.textareaRef.current.value);
  if (!command || (command.action === 'add' && !command.url)) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.requestSubmit();
 }

 /** Вставка упоминания: смещения проверяются по текущему тексту рантайма. */
 function mentionInserted(item: {id: string}) {
  const pending = pendingMention.current;
  pendingMention.current = null;
  const text = runtime.thread.composer.getState().text;
  const range = pending ? insertedMention(pending.start, pending.token, text) : undefined;
  if (range) latest.current.onMentionInserted?.({userId: item.id, ...range}, text);
 }

 /** Локальные команды меняют только текст поля: история и вложения остаются. */
 function executeCommand(item: {id: string}) {
  const kind = localCommand(item.id);
  if (kind === 'clear') runtime.thread.composer.setText('');
  else if (kind === 'search') {
   const text = runtime.thread.composer.getState().text;
   runtime.thread.composer.setText(withoutLeadingSpace(text));
   requestAnimationFrame(() => latest.current.onSearch());
  }
 }

 return {
  runtime,
  formatter,
  matcher: composerTrigger,
  mentionFormatter,
  mentionAdapter,
  commandAdapter,
  handlers: {
   keyDownCapture,
   mentionInserted,
   executeCommand
  }
 };
}

export type AssistantComposerModel = ReturnType<typeof useAssistantComposer>;
