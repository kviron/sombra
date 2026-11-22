import {ComposerSendButton} from '@/shared/ui/elements-composer';
import {useScreenGlitch} from '@/shared/ui/use-screen-glitch';
import {MotionIcon} from '@/shared/ui/motion-icon';
import {UpdateSettings} from '@/features/updates';
import {ColumnResizer} from '@/shared/ui/column-resizer';
import {Select} from '@/shared/ui/select';
import {MessageItem} from './message-item';
import {Friends} from './friends';
import {Bots} from './bots';
import {ExpressionPicker} from '@/features/message-composer';
import {ForwardPicker, ReferenceDraft, type ForwardDestination} from '@/features/message-actions';
import type {ChatMessage} from '@/shared/types';
import {AssistantComposer} from '@/features/message-composer';
import {BotTyping, BotImageActivity, hasLiveImageActivity} from '@/features/bots';
import {useHumanTyping, friendService} from '@/entities/user';
import {DmHeaderIdentity, conversationService} from '@/entities/conversation';
import {BotSettingsDialog} from '@/features/bots';
import {NotificationSettings, accountService} from '@/features/account-settings';
import {AttachmentCacheSettings} from '@/features/account-settings';
import {ConversationMaterials} from '@/features/conversation-details';
import {ConversationInfoDialog, participantCount} from '@/features/conversation-details';
import type {MaterialCategory} from '@/entities/message';
import {messageService} from '@/entities/message';
import {GroupSettingsDialog, type GroupSettingsSection} from '@/features/group-management';
import {canGroup, groupService} from '@/entities/group';
import {DialogListRow} from '@/features/conversation-list';
import {StickerLibrary} from '@/entities/sticker';
import {StickerSuggestions} from '@/features/message-composer';
import {useDirectMessageNotifications} from '@/features/notifications';
import {useNotificationActivation} from '@/features/notifications';
import {UserActionsProvider, type FriendStatus} from '@/shared/lib/user-actions';
import {UnreadMentionBadge} from '@/entities/conversation';
import {editMentionDraft, mentionSendPayload, type MentionDraft} from '@/entities/message';
import {mentionCandidates} from '@/features/message-composer';
import {UserProfile} from './user-profile';
import {MemberList} from './member-list';
import {VoiceQuickSettings} from '@/features/voice-room';
import {NewDialogDialog} from '@/features/conversation-list';
import {useDialogCalls, DialogCallBanner, IncomingDialogCall} from '@/features/voice-room';
import {AttachmentComposer, readAttachment, pastedAttachment} from '@/features/message-composer';
import {AttachmentDropZone} from '@/features/message-composer';
import {AttachmentDraftPreview} from '@/features/message-composer';
import type {AttachmentDraft} from '@/shared/types';

import {useVoice} from '@/features/voice-room';
import {VoiceParticipants} from '@/features/voice-room';
import {VoiceStage, VoiceSettings, VoicePlayback} from '@/features/voice-room';
import {useRoomMusic} from '@/features/voice-room';
import {parseMusicCommand} from '@/shared/lib/music-command';
import type {AccountSection} from '@/features/account-settings';
import {AccountSettingsModal} from '@/features/account-settings';
import {DiagnosticJournal} from '@/features/account-settings';
import {Button} from '@/shared/ui/button';
import {EntityContextMenu} from '@/shared/ui/entity-context-menu';
import {AccountSecurity} from '@/features/account-settings';
import {UserAvatar} from '@/shared/ui/user-avatar';
import {toast} from 'sonner';

import {useEffect, useLayoutEffect, useRef, useState, type FormEvent} from 'react';
import {
 ShieldCheck,
 PanelRight,
 Home,
 Phone,
 Video,
 Bot,
 ChevronDown,
 Volume2,
 Plus,
 MessageCircle,
 Users,
 Settings,
 LogOut,
 Send,
 X,
 Search,
 Mic,
 MicOff,
 Headphones,
 HeadphoneOff
} from 'lucide-react';
import {stateService} from '@/shared/api';
import {
 type ProfileEffectTarget,
 type ChatState,
 type ChatPreferences,
 type DialogPreferences,
 type Group,
 type GroupPermission,
 type Channel,
 type Dialog,
 type User
} from '@/shared/types';
import {sessionService} from '@/shared/api';
import {authService} from '@/entities/user';
import './chat.css';
import {useChatDraft} from '@/features/message-composer';
import {useMessageLink} from '@/features/message-composer';
import {useMessageReadState} from '@/entities/message';
import {chatScrollKey, useChatScroll} from '../lib/use-chat-scroll';
export function LiveChat() {
 const call = useVoice();
 const microphoneOff = call.muted || call.deaf;
 const [accountSection, setAccountSection] = useState<AccountSection>('profile');
 const [botSettingsId, setBotSettingsId] = useState('');
 useEffect(() => {
  const open = () => {
   setAccountSection('updates');
   setSettings(true);
  };
  window.addEventListener('sombra:open-updates', open);
  return () => window.removeEventListener('sombra:open-updates', open);
 }, []);
 const [state, setState] = useState<ChatState | null>(null),
  [groupId, setGroupId] = useState(''),
  [channelId, setChannelId] = useState(''),
  [home, setHome] = useState(true),
  [error, setError] = useState(''),
  [search, setSearch] = useState(''),
  [settings, setSettings] = useState(false),
  [modal, setModal] = useState(''),
  [name, setName] = useState(''),
  [selected, setSelected] = useState<string[]>([]),
  [busy, setBusy] = useState(false),
  [members, setMembers] = useState(false),
  [profileId, setProfileId] = useState('');
 const [replyDrafts, setReplyDrafts] = useState<Record<string, ChatMessage | undefined>>({});
 const [forwardPicker, setForwardPicker] = useState<{owner: string; message: ChatMessage}>();
 const [forwardDrafts, setForwardDrafts] = useState<
  Record<string, {message: ChatMessage; comment: string} | undefined>
 >({});
 const forwardCommentRef = useRef<HTMLTextAreaElement>(null);
 const [materialsOpen, setMaterialsOpen] = useState(false),
  [jumpMessage, setJumpTarget] = useState('');
 const jumpOwner = useRef('');
 const jumpTarget = jumpOwner.current === state?.me.id ? jumpMessage : '';
 const notificationJump = useRef<{channel: string; message: string} | null>(null);
 const [jumpEpoch, bumpJump] = useState(0);
 const materialsTrigger = useRef<HTMLButtonElement>(null);
 const infoTrigger = useRef<HTMLButtonElement>(null);
 const [infoOpen, setInfoOpen] = useState(false),
  [headerProfile, setHeaderProfile] = useState(false),
  [materialsCategory, setMaterialsCategory] = useState<MaterialCategory | 'all'>('all'),
  [materialsEpoch, setMaterialsEpoch] = useState(0);
 function openInfoMaterials(category: MaterialCategory) {
  setInfoOpen(false);
  setProfileId('');
  setHeaderProfile(false);
  setMaterialsCategory(category);
  setMaterialsEpoch(value => value + 1);
  setMaterialsOpen(true);
  requestAnimationFrame(() => document.querySelector<HTMLElement>('#conversation-materials button')?.focus());
 }
 function openInfoProfile(id: string) {
  setInfoOpen(false);
  setHeaderProfile(false);
  requestAnimationFrame(() => {
   infoTrigger.current?.focus();
   setProfileId(id);
  });
 }
 function closeMaterials() {
  setMaterialsOpen(false);
  requestAnimationFrame(() => materialsTrigger.current?.focus());
 }
 function jumpToMessage(id: string, fromMaterials = true) {
  jumpOwner.current = state?.me.id || '';
  setSearch('');
  if (fromMaterials) {
   setMaterialsOpen(false);
   requestAnimationFrame(() => materialsTrigger.current?.focus({preventScroll: true}));
  }
  setJumpTarget(id);
  bumpJump(epoch => epoch + 1);
 }
 useEffect(() => {
  if (!jumpTarget) return;
  const frame = requestAnimationFrame(() => {
   const element = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(jumpTarget)}"]`);
   element
    ?.getAnimations({subtree: true})
    .filter(animation => animation instanceof CSSAnimation && animation.animationName.includes('message-jump'))
    .forEach(animation => {
     animation.currentTime = 0;
     animation.play();
    });
   element?.scrollIntoView({
    block: 'center',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
   });
  });
  const timer = setTimeout(() => setJumpTarget(''), 2500);
  return () => {
   cancelAnimationFrame(frame);
   clearTimeout(timer);
  };
 }, [jumpTarget, jumpEpoch, search]);
 const [rolesGroupId, setRolesGroupId] = useState('');
 const [groupSettingsSection, setGroupSettingsSection] = useState<GroupSettingsSection>('general');
 const rolesGroup = state?.groups.find(item => item.id === rolesGroupId);
 function permits(target: Group | undefined, permission: GroupPermission) {
  return !!state && canGroup(target, state.me.id, permission);
 }
 function canEditGroup(target: Group | undefined) {
  return !!target && !!state && target.members.includes(state.me.id);
 }
 const conversationMotion = useScreenGlitch(`${home}:${groupId}:${channelId}`);
 const settingsMotion = useScreenGlitch(`${settings}:${accountSection}`);
 const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({});
 const pendingFriendRequests = useRef(new Set<string>());
 const meId = state?.me.id;
 const volumeKey = (id: string) => `sombra-participant-volume:${meId}:${id}`;
 function volumeForUser(id: string) {
  if (!meId || !id || id === meId) return 100;
  const key = volumeKey(id);
  const current = participantVolumes[key];
  if (current !== undefined) return current;
  try {
   const stored = localStorage.getItem(key);
   if (stored === null) return 100;
   const value = Number(stored);
   if (Number.isFinite(value) && value >= 0 && value <= 200) return value;
  } catch {}
  return 100;
 }
 function setUserVolume(id: string, volume: number) {
  const key = volumeKey(id);
  setParticipantVolumes(previous => ({...previous, [key]: volume}));
  try {
   localStorage.setItem(key, String(volume));
  } catch {}
 }
 function canRequestFriend(id: string) {
  return (
   !!state &&
   id !== state.me.id &&
   !state.friends.some(
    friend => (friend.from === id && friend.to === state.me.id) || (friend.to === id && friend.from === state.me.id)
   )
  );
 }
 async function requestFriend(id: string) {
  if (!canRequestFriend(id) || pendingFriendRequests.current.has(id)) return;
  pendingFriendRequests.current.add(id);
  try {
   await friendService.request({user: id});
   await refresh();
   toast.success('Заявка в друзья отправлена');
  } catch (e) {
   toast.error((e as Error).message);
  } finally {
   pendingFriendRequests.current.delete(id);
  }
 }
 function friendStatus(id: string): FriendStatus {
  if (!state) return 'none';
  if (id === state.me.id) return 'self';
  const friend = state.friends.find(
   item => (item.from === id && item.to === state.me.id) || (item.to === id && item.from === state.me.id)
  );
  if (!friend) return 'none';
  if (friend.accepted) return 'friends';
  return friend.from === state.me.id ? 'outgoing' : 'incoming';
 }
 async function acceptFriend(id: string) {
  const friend = state?.friends.find(item => item.from === id && item.to === state.me.id);
  if (!friend) return;
  try {
   await friendService.accept(friend.id);
   await refresh();
   toast.success('Заявка принята');
  } catch (e) {
   toast.error((e as Error).message);
  }
 }
 async function removeFriend(id: string) {
  const friend = state?.friends.find(
   item => (item.from === id && item.to === state.me.id) || (item.to === id && item.from === state.me.id)
  );
  if (!friend) return;
  try {
   await friendService.remove(friend.id);
   await refresh();
  } catch (e) {
   toast.error((e as Error).message);
  }
 }
 async function messageUser(id: string) {
  if (!state || id === state.me.id) return;
  const existing = state.dialogs.find(
   dialog => dialog.members.length === 2 && dialog.members.includes(id) && dialog.members.includes(state.me.id)
  );
  if (existing) {
   setHome(true);
   setChannelId(existing.id);
   return;
  }
  try {
   const dialog = await conversationService.createDialog<Dialog>({members: [id], name: ''});
   await refresh();
   setHome(true);
   setChannelId(dialog.id);
  } catch (e) {
   toast.error((e as Error).message);
  }
 }
 function openOwnProfile() {
  setAccountSection('profile');
  setSettings(true);
 }
 const mediaGeneration = useRef(0);
 function mediaSaved(user: User, field: 'avatar' | 'cover' | 'decoration:avatar' | 'decoration:cover') {
  mediaGeneration.current++;
  const merge = (old: User): User => {
   if (old.id !== user.id) return old;
   if (field === 'avatar' || field === 'cover') return {...old, [field]: user[field]};
   const target = field === 'decoration:avatar' ? 'avatar' : 'cover';
   return {
    ...old,
    decorations: {...old.decorations, [target]: user.decorations?.[target]},
    decorationRefs: {...old.decorationRefs, [target]: user.decorationRefs?.[target]},
    profileEffectAssets: {...old.profileEffectAssets, [target]: user.profileEffectAssets?.[target]}
   };
  };
  setState(previous =>
   previous?.me.id === user.id ? {...previous, me: merge(previous.me), users: previous.users.map(merge)} : previous
  );
 }
 async function equipProfileEffect(id: string, target: ProfileEffectTarget) {
  const account = state?.me.id,
   token = sessionService.token();
  if (!account) throw new Error('Учётная запись недоступна');
  const {user, item} = await accountService.applyProfileEffect(id);
  if (sessionService.token() !== token || user.id !== account || item.target !== target)
   throw new Error('Не удалось обновить украшение профиля');
  mediaSaved(user, `decoration:${target}`);
 }
 function applyState(next: ChatState) {
  setState(previous => {
   if (!previous || previous.me.id !== next.me.id) return next;
   const groups = next.groups.map(group => {
    const old = previous.groups.find(item => item.id === group.id);
    return old && (old.rolesRevision || 0) > (group.rolesRevision || 0) ? old : group;
   });
   const chatPreferences =
    previous.chatPreferences &&
    (!next.chatPreferences || (next.chatPreferences.revision || 0) < (previous.chatPreferences.revision || 0))
     ? previous.chatPreferences
     : next.chatPreferences;
   const dialogs = next.dialogs.map(dialog => {
    const old = previous.dialogs.find(item => item.id === dialog.id);
    return old && (old.revision || 0) > (dialog.revision || 0)
     ? {...dialog, name: old.name, avatar: old.avatar, revision: old.revision}
     : dialog;
   });
   return {...next, groups, chatPreferences, dialogs};
  });
 }
 async function savedDialogMetadata(owner: string, dialog: Dialog) {
  const merge = (dialogs: Dialog[]) =>
   dialogs.map(item =>
    item.id === dialog.id && (item.revision || 0) <= (dialog.revision || 0)
     ? {...item, name: dialog.name, avatar: dialog.avatar, owner: dialog.owner, revision: dialog.revision}
     : item
   );
  setState(previous => (previous?.me.id === owner ? {...previous, dialogs: merge(previous.dialogs)} : previous));
  try {
   const next = await stateService.load<ChatState>({sticker_assets: true});
   if (next.me.id !== owner) return;
   setState(previous =>
    previous?.me.id === owner
     ? {
        ...previous,
        dialogs: next.dialogs.map(item => {
         const old = previous.dialogs.find(row => row.id === item.id);
         return old && (old.revision || 0) > (item.revision || 0)
          ? {...item, name: old.name, avatar: old.avatar, revision: old.revision}
          : item;
        })
       }
     : previous
   );
  } catch {
   /* Saved DTO is authoritative; the regular poll retries refresh without discarding the successful save. */
  }
 }
 function applyChatPreferences(owner: string, preferences: ChatPreferences) {
  setState(previous =>
   previous?.me.id === owner && (preferences.revision || 0) >= (previous.chatPreferences?.revision || 0)
    ? {...previous, chatPreferences: preferences}
    : previous
  );
 }
 const pendingDialogPreferences = useRef(new Set<string>());
 const [dialogPreferencesBusy, setDialogPreferencesBusy] = useState<Record<string, boolean>>({});
 function preferencesForDialog(id: string): DialogPreferences {
  const value = state?.chatPreferences?.dialogs[id];
  return {pinned: value?.pinned === true, muted: value?.muted === true};
 }
 async function changeDialogPreferences(dialog: string, patch: Partial<DialogPreferences>) {
  if (!state || pendingDialogPreferences.current.has(dialog)) return;
  const owner = state.me.id;
  pendingDialogPreferences.current.add(dialog);
  setDialogPreferencesBusy(previous => ({...previous, [dialog]: true}));
  try {
   applyChatPreferences(owner, await conversationService.setPreferences<ChatPreferences>({dialog, ...patch}));
  } catch (reason) {
   toast.error(reason instanceof Error ? reason.message : 'Не удалось сохранить настройки чата.');
  } finally {
   pendingDialogPreferences.current.delete(dialog);
   setDialogPreferencesBusy(previous => ({...previous, [dialog]: false}));
  }
 }
 async function refresh() {
  const generation = mediaGeneration.current;
  const next = await stateService.load<ChatState>({sticker_assets: true});
  if (generation === mediaGeneration.current) applyState(next);
  return next;
 }
 useEffect(() => {
  let active = true,
   inFlight = false;
  async function load() {
   // A hung request (30 s timeout) must not stack up behind the two-second tick.
   if (inFlight || document.visibilityState === 'hidden') return;
   inFlight = true;
   const generation = mediaGeneration.current;
   try {
    const next = await stateService.load<ChatState>({sticker_assets: true});
    if (active && generation === mediaGeneration.current) applyState(next);
   } catch (e) {
    if (active) setError((e as Error).message);
   } finally {
    inFlight = false;
   }
  }
  const shown = () => {
   if (document.visibilityState === 'visible') void load();
  };
  void load();
  const timer = setInterval(load, 2000);
  document.addEventListener('visibilitychange', shown);
  return () => {
   active = false;
   clearInterval(timer);
   document.removeEventListener('visibilitychange', shown);
  };
 }, []);
 const dialogCalls = useDialogCalls({
  state,
  voice: call,
  refresh,
  onOpenDialog: id => {
   setHome(true);
   setChannelId(id);
   setModal('');
  }
 });
 const currentDialogCall = home ? dialogCalls.calls.find(item => item.dialog === channelId) : undefined;
 const voiceRoom = home && currentDialogCall ? currentDialogCall.id : undefined;
 const group = state?.groups.find(g => g.id === groupId) || state?.groups[0];
 const canShowMembers = !home && !!group;
 const channel = home
  ? state?.dialogs.find(d => d.id === channelId)
  : group?.channels.find(c => c.id === channelId) ||
    group?.channels.find(c => c.name === 'games') ||
    group?.channels[0];
 const activateNotification = useNotificationActivation(state, (next, route) => {
  applyState(next);
  setSettings(false);
  setModal('');
  setProfileId('');
  setInfoOpen(false);
  setHeaderProfile(false);
  setBotSettingsId('');
  setRolesGroupId('');
  setMaterialsOpen(false);
  setSearch('');
  setError('');
  jumpOwner.current = next.me.id;
  notificationJump.current = {channel: route.channel, message: route.message || ''};
  setHome(route.home);
  if (route.group) setGroupId(route.group);
  setChannelId(route.channel);
  setJumpTarget(route.message || '');
  bumpJump(epoch => epoch + 1);
 });
 useDirectMessageNotifications(state, {
  activeChannel: channel?.id,
  settingsOpen: settings || !!modal || !!profileId || infoOpen,
  onActivate: activateNotification
 });
 const {draft, setDraft: storeDraft, clearSent} = useChatDraft(channel?.id || '');
 const mentionDrafts = useRef<Record<string, MentionDraft>>({});
 useEffect(() => {
  mentionDrafts.current = {};
 }, [state?.me.id]);
 function setDraft(text: string) {
  const id = channel?.id || '';
  mentionDrafts.current[id] = editMentionDraft(mentionDrafts.current[id] || {text: draft, mentions: []}, text);
  storeDraft(text);
  humanTyping.input(!!text.trim());
 }
 /** Aliases are scoped to this conversation, so a stale span for a removed participant is dropped, not sent. */
 function mentionAliases(target: string) {
  if (!state) return [];
  return mentionCandidates(state, target, home ? undefined : group?.id).map(item => {
   const user = state.users.find(row => row.id === item.id),
    bot = state.bots.find(row => row.id === item.id);
   return {id: item.id, name: user?.name || bot?.name || item.label, username: user?.username || bot?.username};
  });
 }
 const messageLink = useMessageLink({
  channel: channel?.id || '',
  draft,
  setDraft,
  disabled: busy || settings || !!modal || !!profileId || infoOpen || !!dialogCalls.incoming
 });
 const [attachments, setAttachments] = useState<Record<string, AttachmentDraft | undefined>>({});
 const [readingAttachments, setReadingAttachments] = useState<Record<string, boolean>>({});
 const attachmentReads = useRef<Record<string, number>>({});
 const attachmentOwner = useRef(meId);
 attachmentOwner.current = meId;
 const attachmentMounted = useRef(true);
 useEffect(() => {
  attachmentMounted.current = true;
  return () => {
   attachmentMounted.current = false;
   attachmentReads.current = {};
  };
 }, []);
 useEffect(() => {
  attachmentReads.current = {};
  setAttachments({});
  setReadingAttachments({});
 }, [meId]);
 const attachment = channel ? attachments[channel.id] : undefined;
 const readingAttachment = channel ? !!readingAttachments[channel.id] : false;
 async function selectAttachment(file: File) {
  if (!channel || busy) return;
  const destination = channel.id,
   owner = meId;
  const epoch = (attachmentReads.current[destination] || 0) + 1;
  const current = () =>
   attachmentMounted.current && attachmentOwner.current === owner && attachmentReads.current[destination] === epoch;
  attachmentReads.current[destination] = epoch;
  setReadingAttachments(previous => ({...previous, [destination]: true}));
  try {
   const result = await readAttachment(file);
   if (current()) setAttachments(previous => ({...previous, [destination]: result}));
  } catch (error) {
   if (current()) toast.error((error as Error).message);
  } finally {
   if (current()) setReadingAttachments(previous => ({...previous, [destination]: false}));
  }
 }
 function removeAttachment() {
  if (!channel) return;
  attachmentReads.current[channel.id] = (attachmentReads.current[channel.id] || 0) + 1;
  setAttachments(previous => ({...previous, [channel.id]: undefined}));
  setReadingAttachments(previous => ({...previous, [channel.id]: false}));
 }
 const [editingChannel, setEditingChannel] = useState<{group: string; channel: Channel} | null>(null);
 const [editingGroup, setEditingGroup] = useState<Pick<Group, 'id' | 'name' | 'avatar'> | null>(null);
 const editingGroupData = state?.groups.find(item => item.id === editingGroup?.id);
 const editingChannelGroup = state?.groups.find(item => item.id === editingChannel?.group);
 const [channelKind, setChannelKind] = useState('text');
 const end = useRef<HTMLDivElement>(null);
 const composerRef = useRef<HTMLDivElement>(null),
  scrollRef = useRef<HTMLDivElement>(null);
 const voice = (!!channel && 'kind' in channel && channel.kind === 'voice') || !!(voiceRoom && call.room === voiceRoom);
 const activeMusicRoom = state?.groups.some(g => g.channels.some(c => c.kind === 'voice' && c.id === call.room))
  ? call.room
  : undefined;
 const roomMusic = useRoomMusic(activeMusicRoom, call.deaf, call.preferences.speaker);
 // The transcript's image-generation card is the activity signal while it is on screen,
 // so the composer row and its dots are not shown at the same time (one meaning, once).
 const imageActivityVisible = !!state && !!channel && hasLiveImageActivity(state, channel.id);
 const [dialogSearch, setDialogSearch] = useState('');
 const referencesSupported = state?.features?.messageReferences === true;
 const referenceKey = JSON.stringify([meId || '', channel?.id || '']);
 const replyDraft = referencesSupported ? replyDrafts[referenceKey] : undefined;
 const forwardDraft = referencesSupported ? forwardDrafts[referenceKey] : undefined;
 const picker = referencesSupported && forwardPicker?.owner === meId ? forwardPicker : undefined;
 function cancelReply(key = referenceKey, sent?: ChatMessage) {
  setReplyDrafts(previous => (sent && previous[key] !== sent ? previous : {...previous, [key]: undefined}));
 }
 function replyTo(message: ChatMessage) {
  setReplyDrafts(previous => ({...previous, [referenceKey]: message}));
  requestAnimationFrame(() => messageLink.textareaRef.current?.focus());
 }
 function chooseForward(item: ForwardDestination) {
  if (!picker || !meId) return;
  const key = JSON.stringify([meId, item.id]);
  setForwardDrafts(previous => ({...previous, [key]: {message: picker.message, comment: ''}}));
  setForwardPicker(undefined);
  setHome(!item.group);
  if (item.group) setGroupId(item.group.id);
  setChannelId(item.id);
  requestAnimationFrame(() => forwardCommentRef.current?.focus());
 }
 function jumpToQuote(id: string) {
  if (!state?.messages.some(message => message.id === id && message.channel === channel?.id)) {
   toast.error('Исходное сообщение недоступно');
   return;
  }
  jumpToMessage(id, false);
 }
 const dialogName = (d: Dialog) =>
  d.members.length === 2
   ? state?.users.find(u => u.id !== state.me.id && d.members.includes(u.id))?.name || d.name
   : d.name;
 const latest = new Map<string, ChatState['messages'][number]>();
 for (const message of state?.messages || []) {
  if (!latest.has(message.channel) || latest.get(message.channel)!.time <= message.time)
   latest.set(message.channel, message);
 }
 const dialogs = (state?.dialogs || [])
  .filter(d => dialogName(d).toLocaleLowerCase().includes(dialogSearch.trim().toLocaleLowerCase()))
  .sort(
   (a, b) =>
    Number(preferencesForDialog(b.id).pinned) - Number(preferencesForDialog(a.id).pinned) ||
    (latest.get(b.id)?.time || 0) - (latest.get(a.id)?.time || 0)
  );
 const showFriends = home && channelId === 'friends';
 const title = showFriends
  ? 'Друзья'
  : channel
    ? home
      ? dialogName(channel as Dialog)
      : channel.name
    : home
      ? 'Выберите переписку'
      : group
        ? 'Выберите канал'
        : 'Выберите группу';
 const dmPeer =
  home && channel && 'members' in channel && channel.members.length === 2
   ? state?.users.find(user => user.id !== state.me.id && (channel as Dialog).members.includes(user.id))
   : undefined;
 const ownerDmBot =
  dmPeer?.bot && !state?.me.bot
   ? state?.bots?.find(bot => bot.id === dmPeer.id && bot.owner === state.me.id)
   : undefined;
 const humanTyping = useHumanTyping(
  state,
  channel?.id || '',
  !!state?.humanTypingSupported &&
   !!dmPeer &&
   !dmPeer.bot &&
   !state?.me.bot &&
   !busy &&
   !settings &&
   !modal &&
   !profileId &&
   !infoOpen &&
   !botSettingsId &&
   !rolesGroupId
 );
 const peerTypingUntil = dmPeer
  ? (dmPeer.bot
     ? state?.botTyping?.filter(row => row.bot === dmPeer.id && row.channel === channel?.id)
     : state?.humanTyping?.filter(row => row.user === dmPeer.id && row.channel === channel?.id)
    )?.reduce((until, row) => (Number.isFinite(row.until) ? Math.max(until, row.until) : until), 0) || 0
  : 0;
 const managedBot =
  state && !state.me.bot ? state.bots?.find(bot => bot.id === botSettingsId && bot.owner === state.me.id) : undefined;
 const userName = (id: string) => state?.users.find(u => u.id === id)?.name || 'Участник';
 function open(kind: string) {
  setChannelKind(kind === 'channel' && !permits(group, 'channels.create_text') ? 'voice' : 'text');
  setModal(kind);
  setName('');
  setSelected([]);
  setError('');
 }
 function editGroup(target: Group) {
  if (!canEditGroup(target)) return;
  setGroupSettingsSection('general');
  setRolesGroupId(target.id);
 }
 function manageStickers(scope: 'personal' | 'group') {
  if (scope === 'group') {
   if (!group || !permits(group, 'stickers.manage')) return;
   setEditingGroup({id: group.id, name: group.name, avatar: group.avatar});
   setModal('group-stickers');
   return;
  }
  setAccountSection('stickers');
  setSettings(true);
 }
 function editChannel(c: Channel) {
  if (!group || (!permits(group, 'channels.rename') && !permits(group, 'channels.delete'))) return;
  setEditingChannel({group: group.id, channel: c});
  setName(c.name);
  setError('');
  setModal('edit-channel');
 }
 function channelSettings(c: Channel) {
  return permits(group, 'channels.rename') || permits(group, 'channels.delete') ? (
   <button
    type="button"
    className="channel-settings"
    title="Настроить канал"
    aria-label={`Настроить канал ${c.name}`}
    onClick={() => editChannel(c)}
   >
    <MotionIcon icon={Settings} kind="settings" size={16} />
   </button>
  ) : null;
 }
 async function sendForward(e: FormEvent) {
  e.preventDefault();
  if (!channel || !forwardDraft || busy) return;
  const sent = forwardDraft,
   key = referenceKey,
   destination = channel.id,
   comment = sent.comment.trim();
  setBusy(true);
  setError('');
  try {
   await messageService.forward<{messages: ChatMessage[]}>({
    message: sent.message.id,
    channel: destination,
    ...(comment ? {comment} : {})
   });
   setForwardDrafts(previous => (previous[key] !== sent ? previous : {...previous, [key]: undefined}));
   scroll.followOnNextUpdate();
   void refresh().catch(reason => setError((reason as Error).message));
  } catch (reason) {
   setError((reason as Error).message);
  } finally {
   setBusy(false);
  }
 }
 async function send(e: FormEvent) {
  e.preventDefault();
  if (!channel || (!draft.trim() && !attachment) || busy || readingAttachment) return;
  const destination = channel.id,
   sent = draft,
   sentAttachment = attachment;
  humanTyping.stop();
  setBusy(true);
  setError('');
  try {
   const musicCommand = !home && voice && !sentAttachment && !replyDraft ? parseMusicCommand(sent) : undefined;
   if (musicCommand) {
    if (activeMusicRoom !== destination) throw new Error('Сначала войдите в эту голосовую комнату.');
    await roomMusic.command(musicCommand.action, musicCommand.url, musicCommand.limit);
    if (mentionDrafts.current[destination]?.text === sent) delete mentionDrafts.current[destination];
    clearSent(destination, sent);
    return;
   }
   // Server trims the stored text; send that same trimmed text so verified UTF-16 offsets match exactly.
   const payload = mentionSendPayload(
    mentionDrafts.current[destination] || {text: sent, mentions: []},
    sent,
    mentionAliases(destination)
   );
   await messageService.send({
    channel: destination,
    text: payload.text,
    mentions: payload.mentions,
    ...(sentAttachment ? {attachment: sentAttachment} : {}),
    ...(replyDraft ? {replyTo: replyDraft.id} : {})
   });
   if (replyDraft) cancelReply(referenceKey, replyDraft);
   if (mentionDrafts.current[destination]?.text === sent) delete mentionDrafts.current[destination];
   clearSent(destination, sent);
   if (sentAttachment)
    setAttachments(previous =>
     previous[destination] === sentAttachment ? {...previous, [destination]: undefined} : previous
    );
   scroll.followOnNextUpdate();
   await refresh();
  } catch (e) {
   setError((e as Error).message);
  } finally {
   setBusy(false);
  }
 }
 async function sendStickerSuggestion(sticker: string, replaceDraft: boolean) {
  if (!channel || busy) return false;
  const destination = channel.id,
   sent = draft;
  humanTyping.stop();
  setBusy(true);
  setError('');
  try {
   await messageService.send({channel: destination, sticker, ...(replyDraft ? {replyTo: replyDraft.id} : {})});
   if (replyDraft) cancelReply(referenceKey, replyDraft);
   if (replaceDraft) clearSent(destination, sent);
   if (replaceDraft && mentionDrafts.current[destination]?.text === sent) delete mentionDrafts.current[destination];
   scroll.followOnNextUpdate();
   void refresh().catch(e => setError(e.message));
   return true;
  } catch (e) {
   setError((e as Error).message);
   return false;
  } finally {
   setBusy(false);
  }
 }
 async function leaveGroup(target: Group) {
  if (!state || target.owner === state.me.id || busy || !window.confirm(`Покинуть группу «${target.name}»?`)) return;
  setBusy(true);
  try {
   await groupService.leave({group: target.id});
   if (target.channels.some(channel => channel.id === call.room)) call.leave();
   if (groupId === target.id) {
    setHome(true);
    setGroupId('');
    setChannelId('');
   }
   await refresh();
  } catch (reason) {
   toast.error((reason as Error).message);
  } finally {
   setBusy(false);
  }
 }
 async function rotateInvite() {
  if (
   !group ||
   !permits(group, 'invite.rotate') ||
   busy ||
   !window.confirm('Заменить код приглашения? Старый код перестанет работать.')
  )
   return;
  setBusy(true);
  setError('');
  try {
   await groupService.rotateInvite({group: group.id});
   await refresh();
   toast.success('Код приглашения обновлён');
  } catch (reason) {
   setError((reason as Error).message);
  } finally {
   setBusy(false);
  }
 }
 async function create(e: FormEvent) {
  e.preventDefault();
  if (busy || modal === 'group-stickers') return;
  setBusy(true);
  setError('');
  try {
   if (modal === 'invite') {
    if (!group || !permits(group, 'members.invite')) return;
    await groupService.invite({group: group.id, email: name.trim()});
    setModal('');
    toast.success('Участник добавлен в группу');
    return;
   }
   if (modal === 'edit-channel' && editingChannel) {
    if (!permits(editingChannelGroup, 'channels.rename')) throw new Error('Нет права переименовывать каналы');
    await groupService.updateChannel({group: editingChannel.group, channel: editingChannel.channel.id, name});
   } else if (modal === 'delete-channel' && editingChannel) {
    if (!permits(editingChannelGroup, 'channels.delete')) throw new Error('Нет права удалять каналы');
    const target = editingChannel.channel.id;
    await groupService.deleteChannel({group: editingChannel.group, channel: target});
    if (call.room === target) call.leave();
    setChannelId(selected => (selected === target ? '' : selected));
    setModal('');
    toast.success('Канал удалён');
   } else if (modal === 'dialog') {
    const d = await conversationService.createDialog<Dialog>({name, members: selected});
    setHome(true);
    setChannelId(d.id);
   } else if (modal === 'group') {
    const created = await groupService.create<Group>({name});
    setGroupId(created.id);
    setChannelId('');
    setHome(false);
   } else if (modal === 'join') {
    const joined = await groupService.join<Group>({invite: name.trim()});
    setGroupId(joined.id);
    setChannelId('');
    setHome(false);
   } else if (modal === 'channel') {
    if (!permits(group, channelKind === 'voice' ? 'channels.create_voice' : 'channels.create_text'))
     throw new Error('Нет права создавать этот тип канала');
    const created = await groupService.createChannel<Channel>({group: group?.id, name, kind: channelKind});
    setChannelId(created.id);
   }
   await refresh();
   setModal('');
  } catch (e) {
   setError((e as Error).message);
  } finally {
   setBusy(false);
  }
 }
 useEffect(() => {
  setSearch('');
  setError('');
  setJumpTarget(
   notificationJump.current && notificationJump.current.channel === channel?.id ? notificationJump.current.message : ''
  );
  notificationJump.current = null;
  setInfoOpen(false);
  setHeaderProfile(false);
  setMaterialsCategory('all');
 }, [channel?.id]);
 const chatMessages = state?.messages.filter(m => m.channel === channel?.id) || [];
 const visibleMessages = search
  ? chatMessages.filter(m => (m.text + ' ' + userName(m.user)).toLowerCase().includes(search.toLowerCase()))
  : chatMessages;
 const messageIds = chatMessages.map(m => m.id);
 const scrollKey = !showFriends && !search ? chatScrollKey(meId || '', channel?.id || '') : '';
 const scroll = useChatScroll(
  scrollRef,
  scrollKey,
  `${messageIds.length}:${messageIds.at(-1) || ''}:${imageActivityVisible}`,
  jumpTarget,
  jumpEpoch,
  messageIds
 );
 // The composer floats over the transcript, so its measured height becomes the
 // scroll container's bottom padding. A CSS variable keeps LiveChat from re-rendering
 // every time the field grows; the observer is the only source of that number.
 useLayoutEffect(() => {
  const composer = composerRef.current,
   scroller = scrollRef.current;
  if (!composer || !scroller) return;
  let frame = 0;
  // The measured panel height is a pure function of the composer, and the scroll jump
  // is deferred a frame: resizing the pad inside the observer callback is what makes
  // browsers report "ResizeObserver loop completed with undelivered notifications".
  const sync = () => {
   scroller.parentElement?.style.setProperty('--sombra-composer-height', `${composer.offsetHeight}px`);
   if (!scroll.sticky.current || !scrollKey) return;
   cancelAnimationFrame(frame);
   frame = requestAnimationFrame(() => {
    if (scroll.sticky.current) scroller.scrollTop = scroller.scrollHeight;
   });
  };
  window.addEventListener('resize', sync);
  sync();
  // Apply the first bottom restoration against the actual composer padding, before
  // its scroll event could turn the temporary padding gap into a history anchor.
  if (scrollKey && scroll.sticky.current) scroller.scrollTop = scroller.scrollHeight;
  const observer = new ResizeObserver(sync);
  observer.observe(composer);
  return () => {
   cancelAnimationFrame(frame);
   observer.disconnect();
   window.removeEventListener('resize', sync);
  };
 }, [channel?.id, voice, showFriends, scrollKey]);
 useEffect(() => {
  if ((!modal || modal === 'dialog' || modal === 'edit-group') && !settings) return;
  const previous = document.activeElement as HTMLElement;
  const dialog = document.querySelector<HTMLElement>('[role=dialog]');
  dialog?.querySelector<HTMLElement>('input,button')?.focus();
  const handle = (e: KeyboardEvent) => {
   if (
    e.defaultPrevented ||
    document.querySelector('[data-image-crop-dialog],.sticker-collection-modal,.sticker-preview-dialog')
   )
    return;
   if (e.key === 'Escape' && !busy) {
    setModal('');
    setSettings(false);
    setError('');
   }
   if (e.key === 'Tab' && dialog) {
    const items = Array.from(
     dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,a[href]')
    );
    const visible = items.filter(item => item.getClientRects().length > 0);
    const first = visible[0],
     last = visible.at(-1);
    if (e.shiftKey && document.activeElement === first) {
     e.preventDefault();
     last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
     e.preventDefault();
     first?.focus();
    }
   }
  };
  window.addEventListener('keydown', handle);
  return () => {
   window.removeEventListener('keydown', handle);
   previous?.focus();
  };
 }, [modal, settings, busy]);
 const profile =
  profileId && state
   ? state.me.id === profileId
     ? state.me
     : state.users.find(user => user.id === profileId)
   : undefined;
 // Draft IDs survive modal closure; only rendered overlays block read receipts.
 useMessageReadState(
  state,
  channel?.id || '',
  settings ||
   !!modal ||
   !!profile ||
   headerProfile ||
   infoOpen ||
   !!rolesGroup ||
   !!managedBot ||
   !!dialogCalls.incoming ||
   showFriends ||
   !!picker,
  scroll.acceptRead
 );

 return (
  <UserActionsProvider
   value={{
    me: state?.me,
    openProfile: id => {
     setHeaderProfile(false);
     setProfileId(id);
    },
    messageUser: id => void messageUser(id),
    editOwnProfile: openOwnProfile,
    friendStatus,
    addFriend: id => void requestFriend(id),
    acceptFriend: id => void acceptFriend(id),
    removeFriend: id => void removeFriend(id)
   }}
  >
   <main className="chat-shell">
    {/* Playback belongs to the joined session, never Home/DM/channel navigation. */}
    <VoicePlayback voice={call} volumeForUser={volumeForUser} />
    {roomMusic.audio}
    <nav className="server-rail" aria-label="Группы">
     <button
      className={'server ' + (home ? 'active' : '')}
      title="Личные сообщения"
      onClick={() => {
       setHome(true);
       setChannelId('');
      }}
     >
      <Home size={22} aria-hidden="true" />
     </button>
     <div className="rail-line" />
     {state?.groups.map(g => (
      <EntityContextMenu
       key={g.id}
       actions={[
        ...(canEditGroup(g) ? [{label: 'Настройки группы', icon: Settings, onSelect: () => editGroup(g)}] : []),
        {
         label: 'Роли и права',
         icon: ShieldCheck,
         onSelect: () => {
          setGroupSettingsSection('roles');
          setRolesGroupId(g.id);
         }
        },
        ...(g.rolesRevision !== undefined && g.owner !== state.me.id
         ? [{label: 'Покинуть группу', icon: LogOut, onSelect: () => void leaveGroup(g)}]
         : [])
       ]}
      >
       <button
        className={'server ' + (!home && group?.id === g.id ? 'active' : '')}
        title={g.name}
        aria-label={g.name}
        onClick={() => {
         setGroupId(g.id);
         setChannelId('');
         setHome(false);
        }}
       >
        {g.avatar ? <img className="server-avatar" src={g.avatar} alt="" /> : g.name.slice(0, 2)}
       </button>
      </EntityContextMenu>
     ))}
     <button className="server" title="Создать группу" onClick={() => open('group')}>
      <Plus />
     </button>
     <button className="server" title="Вступить по приглашению" onClick={() => open('join')}>
      <Users />
     </button>
    </nav>
    <aside className="channel-sidebar">
     <ColumnResizer label="Ширина списка каналов" side="right" variable="--channel-width" min={190} max={480} />
     {home ? (
      <header className="dialog-search-header">
       <label className="dialog-search">
        <Search size={17} />
        <input
         aria-label="Поиск переписок"
         placeholder="Поиск"
         value={dialogSearch}
         onChange={e => setDialogSearch(e.target.value)}
        />
        {dialogSearch && (
         <button aria-label="Очистить поиск переписок" onClick={() => setDialogSearch('')}>
          <X size={15} />
         </button>
        )}
       </label>
       <button className="new-dialog" title="Новый диалог" onClick={() => open('dialog')}>
        <Plus size={19} />
       </button>
      </header>
     ) : (
      <header className="group-header">
       <strong title={group?.name}>{group?.name || 'Ваши группы'}</strong>
       <button title="Новый диалог" onClick={() => open('dialog')}>
        <Plus size={19} />
       </button>
       {group && canEditGroup(group) && (
        <button
         type="button"
         className="group-settings-button"
         title="Настройки группы"
         aria-label="Настройки группы"
         onClick={() => editGroup(group)}
        >
         <MotionIcon icon={Settings} kind="settings" size={17} />
        </button>
       )}
       {group && (
        <button
         type="button"
         className="group-roles-button"
         title="Роли и права"
         aria-label="Роли и права группы"
         onClick={() => {
          setGroupSettingsSection('roles');
          setRolesGroupId(group.id);
         }}
        >
         <ShieldCheck size={17} />
        </button>
       )}
      </header>
     )}
     <div className="channel-list">
      {home ? (
       <>
        <Button
         type="button"
         variant="ghost"
         className={'friends-nav ' + (showFriends ? 'selected' : '')}
         aria-pressed={showFriends}
         onClick={() => setChannelId('friends')}
        >
         <Users size={20} />
         <span>Друзья</span>
         {!!state?.friends.filter(friend => !friend.accepted && friend.to === state.me.id).length && (
          <small>{state.friends.filter(friend => !friend.accepted && friend.to === state.me.id).length}</small>
         )}
        </Button>
        <div className="category">
         Личные сообщения
         <button type="button" title="Создать сообщение" aria-label="Создать сообщение" onClick={() => open('dialog')}>
          <Plus size={15} />
         </button>
        </div>
        <div className="dialog-list" aria-label="Переписки">
         {dialogs.map(d => {
          const last = latest.get(d.id);
          const peer =
           d.members.length === 2
            ? state?.users.find(u => u.id !== state.me.id && d.members.includes(u.id))
            : undefined;
          const name = dialogName(d);
          return (
           <DialogListRow
            readReceiptsSupported={state?.readReceiptsSupported}
            key={d.id}
            dialog={d}
            name={name}
            peer={peer}
            last={last}
            meId={state?.me.id || ''}
            active={d.id === channel?.id}
            preferences={preferencesForDialog(d.id)}
            busy={!!dialogPreferencesBusy[d.id]}
            onSelect={() => setChannelId(d.id)}
            onUpdate={patch => void changeDialogPreferences(d.id, patch)}
           />
          );
         })}
        </div>
        {!dialogs.length && (
         <p className="dialog-empty">
          {dialogSearch.trim()
           ? 'Переписки не найдены'
           : state
             ? 'Пока нет переписок. Нажмите +, чтобы начать разговор.'
             : 'Загрузка переписок…'}
         </p>
        )}
       </>
      ) : (
       <>
        {group && (permits(group, 'members.invite') || permits(group, 'invite.rotate')) && (
         <button className="channel" onClick={() => open('invite')}>
          <Users />
          Пригласить участников
         </button>
        )}
        <div className="category">
         Текстовые каналы
         {permits(group, 'channels.create_text') && (
          <button title="Добавить канал" onClick={() => open('channel')}>
           <Plus size={15} />
          </button>
         )}
        </div>
        {group?.channels
         .filter(c => c.kind === 'text')
         .map(c => (
          <div className={'channel-row ' + (c.id === channel?.id ? 'selected' : '')} key={c.id}>
           <button className={'channel ' + (c.id === channel?.id ? 'selected' : '')} onClick={() => setChannelId(c.id)}>
            <MessageCircle />
            <span>{c.name}</span>
            <UnreadMentionBadge count={c.unreadMentionCount} />
           </button>
           {channelSettings(c)}
          </div>
         ))}
        <div className="category">
         Голосовые каналы
         {permits(group, 'channels.create_voice') && (
          <button
           type="button"
           title="Добавить голосовой канал"
           aria-label="Добавить голосовой канал"
           onClick={() => {
            open('channel');
            setChannelKind('voice');
           }}
          >
           <Plus size={15} />
          </button>
         )}
        </div>
        {group?.channels
         .filter(c => c.kind === 'voice')
         .map(c => (
          <div className="voice-channel" key={c.id}>
           <div className={'channel-row ' + (c.id === channel?.id ? 'selected' : '')}>
            <button
             className={'channel ' + (c.id === channel?.id ? 'selected' : '')}
             key={c.id}
             onClick={() => setChannelId(c.id)}
             onDoubleClick={() => {
              setChannelId(c.id);
              if (call.room !== c.id && !call.busy) void call.join(c.id);
             }}
            >
             <Volume2 />
             <span>{c.name}</span>
             <UnreadMentionBadge count={c.unreadMentionCount} />
            </button>
            {channelSettings(c)}
           </div>
           <VoiceParticipants
            voice={call}
            room={c.id}
            title={c.name}
            me={state?.me}
            users={state?.users || []}
            presence={state?.voicePresence?.[c.id]}
            volumeForUser={volumeForUser}
            setUserVolume={setUserVolume}
           />
          </div>
         ))}
        {!group && <p>Создайте группу или вступите по приглашению.</p>}
       </>
      )}
     </div>
     {call.room && (
      <div className="voice-status">
       Голосовая связь ·{' '}
       {state?.groups.flatMap(g => g.channels).find(c => c.id === call.room)?.name ||
        state?.dialogs.find(dialog => dialog.id === dialogCalls.calls.find(item => item.id === call.room)?.dialog)
         ?.name ||
        'Личный звонок'}
       <button onClick={call.leave}>Отключиться</button>
      </div>
     )}
     <footer className="profile">
      <button
       type="button"
       className="profile-self"
       title="Открыть свой профиль"
       onClick={() => state && setProfileId(state.me.id)}
      >
       {state ? (
        <UserAvatar user={state.me} size="md" decoration={state.me.decorations?.avatar} />
       ) : (
        <span className="avatar" />
       )}
       <span className="profile-name">
        <strong>{state?.me.name || 'Загрузка…'}</strong>
        <small>{state?.me.online ? 'В сети' : 'Не в сети'}</small>
       </span>
      </button>
      <div className="voice-device-control">
       <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={microphoneOff ? 'Включить микрофон' : 'Выключить микрофон'}
        aria-label="Микрофон"
        aria-pressed={microphoneOff}
        onClick={call.toggleMic}
       >
        {microphoneOff ? (
         <MotionIcon icon={MicOff} kind="device" size={18} className="text-red-400" />
        ) : (
         <MotionIcon icon={Mic} kind="device" size={18} />
        )}
       </Button>
       <VoiceQuickSettings
        voice={call}
        kind="input"
        onSettings={() => {
         setAccountSection('voice');
         setSettings(true);
        }}
       />
      </div>
      <div className="voice-device-control">
       <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={call.deaf ? 'Включить звук' : 'Отключить звук'}
        aria-label="Наушники"
        aria-pressed={call.deaf}
        onClick={call.toggleDeaf}
       >
        {call.deaf ? (
         <MotionIcon icon={HeadphoneOff} kind="device" size={18} className="text-red-400" />
        ) : (
         <MotionIcon icon={Headphones} kind="device" size={18} />
        )}
       </Button>
       <VoiceQuickSettings
        voice={call}
        kind="output"
        onSettings={() => {
         setAccountSection('voice');
         setSettings(true);
        }}
       />
      </div>
      <button title="Настройки пользователя" onClick={() => setSettings(true)}>
       <MotionIcon icon={Settings} kind="settings" size={19} />
      </button>
     </footer>
    </aside>
    <AttachmentDropZone
     channel={channel?.id}
     disabled={
      !!forwardDraft ||
      !!picker ||
      busy ||
      readingAttachment ||
      settings ||
      !!modal ||
      !!profileId ||
      infoOpen ||
      !!dialogCalls.incoming
     }
     onFile={file => void selectAttachment(file)}
    >
     <header className="chat-header">
      {!dmPeer &&
       (home && channel && 'members' in channel && channel.members.length > 2 && channel.avatar ? (
        <img className="dialog-header-avatar" src={channel.avatar} alt="" />
       ) : home ? (
        <MessageCircle />
       ) : voice ? (
        <Volume2 />
       ) : (
        <MessageCircle />
       ))}
      {channel && !showFriends ? (
       <button
        ref={infoTrigger}
        type="button"
        className={`chat-conversation-info${dmPeer ? 'dm-header-info' : ''}`}
        aria-label="Информация о чате"
        title="Информация о чате"
        onClick={() => {
         if (home && 'members' in channel && channel.members.length === 2) {
          if (dmPeer) {
           setHeaderProfile(true);
           setProfileId(dmPeer.id);
          } else setInfoOpen(true);
         } else setInfoOpen(true);
        }}
       >
        {dmPeer ? <DmHeaderIdentity user={dmPeer} typingUntil={peerTypingUntil} /> : <strong>{title}</strong>}
        {home && 'members' in channel && channel.members.length > 2 && (
         <small>{participantCount(channel.members.length)}</small>
        )}
       </button>
      ) : (
       <strong>{title}</strong>
      )}
      <div className="header-actions">
       {ownerDmBot && (
        <Button
         type="button"
         variant="ghost"
         size="icon-sm"
         title="Управление ботом"
         aria-label="Управление ботом"
         onClick={() => setBotSettingsId(ownerDmBot.id)}
        >
         <Settings />
        </Button>
       )}
       {home && channel && !showFriends && !dmPeer?.bot && (
        <div className="dialog-call-header-actions">
         <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Начать аудиозвонок"
          aria-label="Начать аудиозвонок"
          disabled={dialogCalls.busy || call.busy}
          onClick={() => void dialogCalls.start(channel.id, false)}
         >
          <Phone />
         </Button>
         <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Начать видеозвонок"
          aria-label="Начать видеозвонок"
          disabled={dialogCalls.busy || call.busy}
          onClick={() => void dialogCalls.start(channel.id, true)}
         >
          <Video />
         </Button>
        </div>
       )}
       {!home && channel && (
        <button title="Боты комнаты" onClick={() => open('bots')}>
         <Bot />
        </button>
       )}
       {canShowMembers && (
        <button
         title="Участники"
         aria-pressed={members && !materialsOpen}
         onClick={() => {
          setMaterialsOpen(false);
          setMembers(open => (materialsOpen ? true : !open));
         }}
        >
         <Users />
        </button>
       )}
       <label className="chat-search">
        <input
         aria-label="Поиск сообщений"
         placeholder="Поиск сообщений"
         value={search}
         onChange={e => setSearch(e.target.value)}
        />
        <Search size={17} />
       </label>
       {channel && !showFriends && (
        <button
         ref={materialsTrigger}
         type="button"
         className="materials-toggle"
         aria-label="Открыть материалы переписки"
         title="Фото, файлы и ссылки"
         aria-controls="conversation-materials"
         aria-expanded={materialsOpen}
         onClick={() => {
          setMaterialsCategory('all');
          setMaterialsEpoch(value => value + 1);
          setMaterialsOpen(open => !open);
         }}
        >
         <PanelRight size={19} />
        </button>
       )}
      </div>
     </header>
     {error && (
      <div className="chat-notice" role="alert">
       {error}
       <a href="#login">Войти</a>
       <button onClick={() => setError('')} title="Закрыть">
        <X size={16} />
       </button>
      </div>
     )}
     {dialogCalls.error && !dialogCalls.incoming && (
      <div className="chat-notice" role="alert">
       {dialogCalls.error}
       <button type="button" aria-label="Закрыть ошибку звонка" onClick={dialogCalls.clearError}>
        <X size={16} />
       </button>
      </div>
     )}
     {currentDialogCall && (
      <DialogCallBanner
       call={currentDialogCall}
       joined={call.room === currentDialogCall.id}
       busy={dialogCalls.busy || call.busy}
       onJoin={() => void dialogCalls.join(currentDialogCall)}
       onLeave={call.leave}
      />
     )}
     <div className="conversation-body" ref={conversationMotion}>
      <div className={voice ? 'chat-main voice-layout' : 'chat-main'}>
       {voice && (
        <ColumnResizer
         label="Ширина чата канала"
         side="left"
         variable="--voice-chat-width"
         min={260}
         max={600}
         target=".voice-messages"
        />
       )}
       {showFriends && state ? (
        <Friends
         state={state}
         refresh={refresh}
         onError={setError}
         onDialog={id => {
          setHome(true);
          setChannelId(id);
         }}
        />
       ) : voice ? (
        <VoiceStage
         music={!home ? roomMusic : undefined}
         voice={call}
         id={voiceRoom || channel!.id}
         title={title}
         userName={userName}
         me={state?.me.name || 'Вы'}
         meUser={state?.me}
         users={state?.users}
         onSettings={() => {
          setAccountSection('voice');
          setSettings(true);
         }}
        />
       ) : (
        <div className="message-scroll" ref={scrollRef} tabIndex={-1} role="region" aria-label="Сообщения">
         {!channel && home && state ? (
          <p className="conversation-empty">Выберите переписку слева или начните новый диалог кнопкой +.</p>
         ) : (
          <>
           {!visibleMessages.length && !search && (
            <p className="conversation-empty">
             {channel
              ? 'Пока тихо. Начните разговор — отправьте первое сообщение.'
              : 'Выберите или создайте комнату, чтобы начать общение.'}
            </p>
           )}
           {state &&
            visibleMessages.map((m, i) => (
             <div
              key={m.id}
              data-message-id={m.id}
              className={jumpTarget === m.id ? 'message-jump-highlight' : undefined}
             >
              {(i === 0 ||
               new Date(m.time * 1000).toDateString() !==
                new Date(visibleMessages[i - 1].time * 1000).toDateString()) && (
               <div className="chat-day">
                <span>
                 {new Date(m.time * 1000).toLocaleDateString('ru', {day: 'numeric', month: 'long', year: 'numeric'})}
                </span>
               </div>
              )}
              <MessageItem
               previous={visibleMessages[i - 1]}
               message={m}
               state={state}
               refresh={refresh}
               onError={setError}
               userName={userName}
               onReply={referencesSupported && !busy ? replyTo : undefined}
               onForward={
                referencesSupported && !busy ? message => setForwardPicker({owner: state.me.id, message}) : undefined
               }
               onJump={jumpToQuote}
              />
             </div>
            ))}
           {state && !search && channel && <BotImageActivity state={state} channel={channel.id} />}
          </>
         )}
         {search && !visibleMessages.length && <p className="no-results">Сообщения не найдены</p>}
         <div ref={end} />
        </div>
       )}
       {scroll.mode && scrollKey && (
        <Button
         type="button"
         variant="ghost"
         size="icon"
         className="chat-scroll-down"
         title={scroll.mode === 'read' ? 'К последнему прочитанному сообщению' : 'В конец чата'}
         aria-label={scroll.mode === 'read' ? 'К последнему прочитанному сообщению' : 'В конец чата'}
         onClick={scroll.goDown}
        >
         <ChevronDown aria-hidden="true" size={20} />
         {(channel?.unreadCount ?? 0) > 0 && (
          <span className="chat-scroll-unread" aria-label={`Непрочитанных сообщений: ${channel?.unreadCount}`}>
           {channel!.unreadCount! > 99 ? '99+' : channel!.unreadCount}
          </span>
         )}
        </Button>
       )}
       {voice && (
        <div
         className="voice-messages"
         ref={scrollRef}
         tabIndex={-1}
         role="region"
         aria-label="Сообщения голосового канала"
        >
         <h3>Чат канала · {title}</h3>
         {state &&
          visibleMessages.map((m, i) => (
           <div
            key={m.id}
            data-message-id={m.id}
            className={jumpTarget === m.id ? 'message-jump-highlight' : undefined}
           >
            {(i === 0 ||
             new Date(m.time * 1000).toDateString() !==
              new Date(visibleMessages[i - 1].time * 1000).toDateString()) && (
             <div className="chat-day">
              <span>
               {new Date(m.time * 1000).toLocaleDateString('ru', {day: 'numeric', month: 'long', year: 'numeric'})}
              </span>
             </div>
            )}
            <MessageItem
             previous={visibleMessages[i - 1]}
             message={m}
             state={state}
             refresh={refresh}
             onError={setError}
             userName={userName}
             onReply={referencesSupported && !busy ? replyTo : undefined}
             onForward={
              referencesSupported && !busy ? message => setForwardPicker({owner: state.me.id, message}) : undefined
             }
             onJump={jumpToQuote}
            />
           </div>
          ))}
         {state && channel && (
          <>
           <BotImageActivity state={state} channel={channel.id} />
           {!imageActivityVisible && <BotTyping state={state} channel={channel.id} />}
          </>
         )}
         <div ref={end} />
        </div>
       )}
       {channel && (
        <div className="composer-chrome dark" ref={composerRef}>
         {state && !voice && !imageActivityVisible && <BotTyping state={state} channel={channel.id} />}
         {forwardDraft ? (
          <>
           <ReferenceDraft
            kind="forward"
            message={forwardDraft.message}
            author={userName(forwardDraft.message.user)}
            disabled={busy}
            onCancel={() => {
             setForwardDrafts(previous => ({...previous, [referenceKey]: undefined}));
             requestAnimationFrame(() => messageLink.textareaRef.current?.focus());
            }}
           />
           <form className="forward-composer" onSubmit={sendForward}>
            <textarea
             ref={forwardCommentRef}
             aria-label="Комментарий к пересылке"
             placeholder="Добавить комментарий (необязательно)"
             rows={1}
             maxLength={2000}
             disabled={busy}
             value={forwardDraft.comment}
             onChange={event => {
              const comment = event.target.value;
              setForwardDrafts(previous => ({...previous, [referenceKey]: {...forwardDraft, comment}}));
             }}
             onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
               event.preventDefault();
               event.currentTarget.form?.requestSubmit();
              }
             }}
            />
            <ComposerSendButton
             type="submit"
             disabled={busy}
             title="Отправить пересылку"
             aria-label="Отправить пересылку"
            >
             <MotionIcon icon={Send} kind="send" size={16} />
            </ComposerSendButton>
           </form>
          </>
         ) : (
          <>
           {replyDraft && (
            <ReferenceDraft
             kind="reply"
             message={replyDraft}
             author={userName(replyDraft.user)}
             disabled={busy}
             onCancel={() => cancelReply()}
            />
           )}
           <AssistantComposer
            onMentionInserted={(mention, text) => {
             const id = channel?.id || '';
             const current = editMentionDraft(mentionDrafts.current[id] || {text: draft, mentions: []}, text);
             mentionDrafts.current[id] = {
              text,
              mentions: [...current.mentions.filter(m => m.end <= mention.start || m.start >= mention.end), mention]
             };
            }}
            key={`${meId}:${channel.id}`}
            state={state!}
            channel={channel.id}
            group={home ? undefined : group?.id}
            draft={draft}
            setDraft={setDraft}
            onSubmit={send}
            onSearch={() => document.querySelector<HTMLInputElement>('.chat-search input')?.focus()}
            disabled={!channel}
            sendDisabled={busy || readingAttachment || !channel || (!draft.trim() && !attachment)}
            attachments={
             <AttachmentDraftPreview
              key={`${meId}:${channel.id}`}
              draft={attachment}
              reading={readingAttachment}
              disabled={busy}
              onRemove={removeAttachment}
             />
            }
            hasAttachment={!!attachment}
            placeholder={`Написать в ${title}`}
            textareaRef={messageLink.textareaRef}
            onPaste={event => {
             const file = pastedAttachment(event);
             if (file) void selectAttachment(file);
            }}
            sendButton={
             <ComposerSendButton
              type="submit"
              title="Отправить сообщение"
              disabled={busy || readingAttachment || !channel || (!draft.trim() && !attachment)}
             >
              <MotionIcon icon={Send} kind="send" size={16} />
             </ComposerSendButton>
            }
           >
            <AttachmentComposer
             reading={readingAttachment}
             disabled={busy}
             onFile={file => void selectAttachment(file)}
             onRemove={removeAttachment}
            />
            {state && (
             <StickerSuggestions
              key={channel.id}
              draft={draft}
              stickers={state.stickers}
              user={state.me.id}
              group={home ? undefined : group?.id}
              busy={busy}
              onSelect={sendStickerSuggestion}
             />
            )}
            {state && (
             <ExpressionPicker
              key={channel.id}
              state={state}
              refresh={refresh}
              onError={setError}
              disabled={busy}
              group={home ? undefined : group}
              onManage={manageStickers}
              onEmoji={e => setDraft(draft + e)}
              onSticker={async sticker => {
               if (!(await sendStickerSuggestion(sticker, false))) throw new Error('Не удалось отправить стикер');
              }}
             />
            )}
           </AssistantComposer>
          </>
         )}
        </div>
       )}
      </div>
      {!materialsOpen && canShowMembers && members && (
       <aside className="member-list" aria-label="Участники">
        <ColumnResizer label="Ширина списка участников" side="left" variable="--member-width" min={180} max={420} />
        {state && group ? (
         <MemberList members={group.members} users={state.users} meId={state.me.id} group={group} />
        ) : (
         <p className="member-empty">Загрузка участников…</p>
        )}
       </aside>
      )}
      {materialsOpen && channel && !showFriends && state && (
       <ConversationMaterials
        key={`${channel.id}:${materialsEpoch}`}
        initialCategory={materialsCategory}
        channel={channel.id}
        title={title}
        messages={state.messages}
        userName={userName}
        onClose={closeMaterials}
        onJump={jumpToMessage}
       />
      )}
     </div>
    </AttachmentDropZone>
    {settings && (
     <AccountSettingsModal
      me={state?.me}
      section={accountSection}
      onSection={setAccountSection}
      onLogout={() => {
       void authService.logout().catch(e => setError(e.message));
      }}
      onClose={() => setSettings(false)}
      panelRef={settingsMotion}
     >
      {accountSection === 'journal' ? (
       <DiagnosticJournal />
      ) : accountSection === 'updates' ? (
       <UpdateSettings inCall={!!call.room || call.busy} />
      ) : accountSection === 'notifications' ? (
       <NotificationSettings
        preferences={state?.chatPreferences}
        ready={!!state}
        onSaved={preferences => {
         if (state) applyChatPreferences(state.me.id, preferences);
        }}
       />
      ) : accountSection === 'storage' ? (
       <AttachmentCacheSettings key={state?.me.id || 'loading'} ready={!!state} onChanged={refresh} />
      ) : accountSection === 'voice' ? (
       <VoiceSettings voice={call} />
      ) : accountSection === 'stickers' && state ? (
       <StickerLibrary
        key={state.me.id}
        stickers={state.stickers}
        user={state.me.id}
        catalog={state.stickerCatalogSupported}
        refresh={refresh}
       />
      ) : (
       <AccountSecurity state={state} refresh={refresh} section={accountSection} onMediaSaved={mediaSaved} />
      )}
     </AccountSettingsModal>
    )}
    {modal === 'dialog' && state && (
     <NewDialogDialog
      state={state}
      refresh={refresh}
      onClose={() => setModal('')}
      onCreated={dialog => {
       setHome(true);
       setChannelId(dialog.id);
       setModal('');
      }}
     />
    )}
    {dialogCalls.incoming && state && (
     <IncomingDialogCall
      call={dialogCalls.incoming}
      state={state}
      busy={dialogCalls.incomingBusy}
      declining={dialogCalls.incomingDeclining}
      hasOtherVoice={!!call.room && call.room !== dialogCalls.incoming.id}
      error={dialogCalls.error}
      onAccept={video => void dialogCalls.join(dialogCalls.incoming!, video)}
      onDecline={() => void dialogCalls.decline(dialogCalls.incoming!)}
     />
    )}
    {modal && modal !== 'dialog' && modal !== 'edit-group' && (
     <div className="modal-backdrop">
      <form
       className="group-modal"
       role="dialog"
       aria-modal="true"
       aria-label={
        modal === 'delete-channel' ? 'Удалить канал' : modal === 'edit-group' ? 'Настройки группы' : 'Управление чатами'
       }
       onSubmit={create}
      >
       <h2>
        {
         {
          group: 'Создать группу',
          join: 'Вступить в группу',
          dialog: 'Новый диалог',
          channel: 'Создать канал',
          'edit-channel': 'Настроить канал',
          'delete-channel': 'Удалить канал',
          'edit-group': 'Настройки группы',
          'group-stickers': 'Стикеры группы',
          invite: 'Пригласить участников',
          bots: 'Подключения'
         }[modal]
        }
       </h2>
       {modal === 'group-stickers' && state && editingGroup ? (
        permits(editingGroupData, 'stickers.manage') ? (
         <StickerLibrary stickers={state.stickers} user={state.me.id} group={editingGroup.id} refresh={refresh} />
        ) : (
         <p role="status">Нет права управлять стикерами этой группы.</p>
        )
       ) : modal === 'bots' && state && channel ? (
        <Bots
         state={state}
         refresh={refresh}
         onError={setError}
         channel={channel.id}
         group={group?.id}
         owner={permits(group, 'bots.manage')}
        />
       ) : modal === 'invite' ? (
        <>
         {permits(group, 'members.invite') && (
          <>
           <label htmlFor="invite-email">Email аккаунта Sombra</label>
           <input
            id="invite-email"
            type="email"
            autoComplete="off"
            autoFocus
            required
            disabled={busy}
            maxLength={254}
            value={name}
            onChange={e => {
             setName(e.target.value);
             setError('');
            }}
           />
          </>
         )}
         {permits(group, 'members.invite') && !!group?.invite && (
          <>
           <p>Код приглашения</p>
           <input readOnly aria-label="Код приглашения" value={group?.invite || ''} />
           <button
            type="button"
            className="small-button"
            onClick={() => {
             if (!permits(group, 'members.invite') || !group?.invite) return;
             void navigator.clipboard
              .writeText(group.invite)
              .then(() => toast.success('Код скопирован'))
              .catch(() => setError('Выделите и скопируйте код вручную'));
            }}
           >
            Скопировать приглашение
           </button>
          </>
         )}
         {group?.rolesRevision !== undefined && permits(group, 'invite.rotate') && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void rotateInvite()}>
           Заменить код приглашения
          </Button>
         )}
        </>
       ) : modal === 'delete-channel' ? (
        <p>Канал «{editingChannel?.channel.name}» и все его сообщения будут удалены без возможности восстановления.</p>
       ) : (
        <>
         {modal === 'edit-channel' && <label htmlFor="channel-edit-name">Название канала</label>}
         <input
          id={modal === 'edit-channel' ? 'channel-edit-name' : undefined}
          autoFocus
          disabled={busy || (modal === 'edit-channel' && !permits(editingChannelGroup, 'channels.rename'))}
          required={modal !== 'dialog'}
          aria-label={modal === 'join' ? 'Код приглашения' : 'Название'}
          placeholder={modal === 'join' ? 'Код приглашения' : 'Название'}
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={modal === 'channel' || modal === 'edit-channel' ? 40 : 60}
         />
         {modal === 'channel' && (
          <label className="channel-kind">
           Тип канала
           <Select
            label="Тип канала"
            value={channelKind}
            onValueChange={setChannelKind}
            options={[
             ...(permits(group, 'channels.create_text') ? [{value: 'text', label: 'Текстовый'}] : []),
             ...(permits(group, 'channels.create_voice') ? [{value: 'voice', label: 'Голосовой с чатом'}] : [])
            ]}
           />
          </label>
         )}
         {modal === 'dialog' && (
          <div style={{display: 'block', maxHeight: 220, overflow: 'auto'}}>
           {state?.users
            .filter(u => u.id !== state.me.id)
            .map(u => (
             <label key={u.id} style={{display: 'flex', alignItems: 'center', gap: 10}}>
              <input
               style={{width: 18, margin: 8}}
               type="checkbox"
               disabled={!selected.includes(u.id) && selected.length >= 9}
               checked={selected.includes(u.id)}
               onChange={e => setSelected(e.target.checked ? [...selected, u.id] : selected.filter(id => id !== u.id))}
              />
              {u.name}
             </label>
            ))}
           {state?.users.length === 1 && (
            <p>Пока вы первый пользователь. Создайте второй аккаунт, чтобы начать диалог.</p>
           )}
          </div>
         )}
        </>
       )}
       {error && <p role="alert">{error}</p>}
       <div className={modal === 'edit-channel' ? 'channel-settings-actions' : undefined}>
        {modal === 'edit-channel' && permits(editingChannelGroup, 'channels.delete') && (
         <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() => {
           setError('');
           setModal('delete-channel');
          }}
         >
          Удалить канал
         </Button>
        )}
        <button
         type="button"
         disabled={busy}
         onClick={() => {
          setModal(modal === 'delete-channel' ? 'edit-channel' : '');
          setError('');
         }}
        >
         {modal === 'delete-channel' ? 'Отмена' : 'Закрыть'}
        </button>
        {modal === 'delete-channel' && (
         <Button
          type="submit"
          variant="destructive"
          size="sm"
          disabled={busy || !permits(editingChannelGroup, 'channels.delete')}
         >
          {busy ? 'Удаление…' : 'Удалить канал'}
         </Button>
        )}
        {modal === 'invite' && permits(group, 'members.invite') && (
         <button type="submit" className="small-button" disabled={busy || !name.trim()}>
          {busy ? 'Добавление…' : 'Пригласить'}
         </button>
        )}
        {modal !== 'invite' &&
         modal !== 'bots' &&
         modal !== 'delete-channel' &&
         modal !== 'group-stickers' &&
         (modal !== 'edit-channel' || permits(editingChannelGroup, 'channels.rename')) && (
          <button
           className="small-button"
           disabled={
            busy ||
            (modal === 'channel' &&
             !permits(group, channelKind === 'voice' ? 'channels.create_voice' : 'channels.create_text')) ||
            (modal === 'edit-channel' && (!name.trim() || name.trim() === editingChannel?.channel.name)) ||
            (modal === 'dialog' && (!selected.length || selected.length > 9))
           }
          >
           {modal === 'edit-channel' ? (busy ? 'Сохранение…' : 'Сохранить') : 'Готово'}
          </button>
         )}
       </div>
      </form>
     </div>
    )}
    {managedBot && state && (
     <BotSettingsDialog bot={managedBot} state={state} refresh={refresh} onClose={() => setBotSettingsId('')} />
    )}
    {rolesGroup && state && (
     <GroupSettingsDialog
      key={rolesGroup.id}
      initialSection={groupSettingsSection}
      group={rolesGroup}
      state={state}
      onClose={() => setRolesGroupId('')}
      refresh={refresh}
      onError={message => toast.error(message)}
      onManageStickers={id => {
       const target = state.groups.find(item => item.id === id);
       if (!target || !permits(target, 'stickers.manage')) return;
       setEditingGroup({id: target.id, name: target.name, avatar: target.avatar});
       setRolesGroupId('');
       setModal('group-stickers');
      }}
     />
    )}
    {picker && state && (
     <ForwardPicker
      source={picker.message}
      author={userName(picker.message.user)}
      onClose={() => {
       setForwardPicker(undefined);
       requestAnimationFrame(() =>
        document
         .querySelector<HTMLElement>(`[data-read-message-id="${CSS.escape(picker.message.id)}"]`)
         ?.focus({preventScroll: true})
       );
      }}
      onChoose={chooseForward}
      destinations={[
       ...state.dialogs.map(dialog => ({
        id: dialog.id,
        name: dialogName(dialog),
        keywords: state.users
         .filter(user => dialog.members.includes(user.id))
         .map(user => user.username || '')
         .join(' ')
       })),
       ...state.groups.flatMap(group =>
        group.channels.map(channel => ({
         id: channel.id,
         name: channel.name,
         group: {id: group.id, name: group.name},
         voice: channel.kind === 'voice'
        }))
       )
      ]}
     />
    )}
    {messageLink.dialog}
    {infoOpen && channel && state && !showFriends && (
     <ConversationInfoDialog
      key={`${state.me.id}:${channel.id}`}
      state={state}
      title={home ? title : group?.name || title}
      channel={channel.id}
      dialog={home && 'members' in channel ? channel : undefined}
      onSaved={savedDialogMetadata}
      memberIds={home && 'members' in channel ? channel.members : group?.members || []}
      avatar={home && 'members' in channel ? channel.avatar : group?.avatar}
      channelLabel={!home ? channel.name : undefined}
      onClose={() => setInfoOpen(false)}
      onProfile={openInfoProfile}
      onMaterials={openInfoMaterials}
      onSettings={
       !home && group
        ? () => {
           setInfoOpen(false);
           requestAnimationFrame(() => {
            setGroupSettingsSection('general');
            setRolesGroupId(group.id);
           });
          }
        : undefined
      }
     />
    )}
    {profile && state && (
     <UserProfile
      key={`${state.me.id}:${profile.id}`}
      user={profile}
      me={state.me}
      groups={state.groups}
      onApplyEffect={state.effectCatalogSupported ? equipProfileEffect : undefined}
      restoreFocusRef={headerProfile ? infoTrigger : undefined}
      conversationMaterials={
       headerProfile &&
       home &&
       channel &&
       'members' in channel &&
       channel.members.length === 2 &&
       dmPeer?.id === profile.id
        ? {messages: state.messages, channel: channel.id, onOpen: openInfoMaterials}
        : undefined
      }
      onClose={() => {
       setProfileId('');
       setHeaderProfile(false);
      }}
      onOpenGroup={id => {
       setGroupId(id);
       setChannelId('');
       setHome(false);
      }}
     />
    )}
   </main>
  </UserActionsProvider>
 );
}
