import {authenticate, logout, request} from './transport';

type Payload = Record<string, unknown>;
type Method = <T = unknown>(payload?: Payload) => Promise<T>;

const method =
 (op: string): Method =>
 <T = unknown>(payload: Payload = {}) =>
  request<T>(op, payload);

/**
 * Все запросы приложения одним объектом: группы по владельцу данных, методы по операции.
 * Напрямую этот объект вызывают только сервисы сущностей и фич — не компоненты.
 */
export const api = {
 state: {load: method('state')},
 auth: {
  me: method('me'),
  login: (payload: Payload = {}) => authenticate('login', payload),
  register: (payload: Payload = {}) => authenticate('register', payload),
  logout: () => logout(),
  logoutAll: method('logout_all'),
  changePassword: method('change_password'),
  changeEmail: method('change_email')
 },
 user: {
  updateProfile: method('update_profile'),
  setCover: method('set_profile_cover'),
  setDecoration: method('set_profile_decoration'),
  sessions: method('sessions'),
  revokeSession: method('revoke_session'),
  setTyping: method('set_typing')
 },
 message: {
  send: method('message'),
  update: method('update_message'),
  remove: method('delete_message'),
  forward: method('forward_message'),
  react: method('reaction'),
  readers: method('message_readers'),
  markRead: method('mark_messages_read'),
  attachment: method('attachment_file')
 },
 conversation: {
  createDialog: method('create_dialog'),
  update: method('update_dialog'),
  setPreferences: method('set_dialog_preferences'),
  searchMembers: method('search_conversation_members')
 },
 group: {
  create: method('create_group'),
  update: method('update_group'),
  join: method('join_group'),
  leave: method('leave_group'),
  invite: method('invite_group_member'),
  rotateInvite: method('rotate_group_invite'),
  createChannel: method('create_channel'),
  updateChannel: method('update_channel'),
  deleteChannel: method('delete_channel'),
  setMemberInvites: method('set_group_member_invites'),
  setMemberRole: method('set_group_member_role'),
  kickMember: method('kick_group_member'),
  saveRole: method('save_group_role'),
  deleteRole: method('delete_group_role')
 },
 friend: {
  request: method('friend_request'),
  accept: method('friend_accept'),
  remove: method('friend_remove')
 },
 sticker: {
  image: method('sticker_image'),
  listPublicPacks: method('list_public_sticker_packs'),
  installPublicPack: method('install_public_sticker_pack'),
  importPack: method('import_sticker_pack'),
  removeInstalledPack: method('remove_installed_sticker_pack'),
  removeSticker: method('remove_sticker'),
  removePack: method('remove_sticker_pack'),
  setPackPublic: method('set_sticker_pack_public')
 },
 bot: {
  settings: method('get_bot_settings'),
  updateSettings: method('update_bot_settings'),
  modelSettings: method('bot_get_model_settings'),
  updateModelSettings: method('bot_update_settings'),
  toolUsers: method('get_bot_tool_users'),
  setToolUsers: method('set_bot_tool_users'),
  create: method('create_bot'),
  remove: method('delete_bot'),
  removeFromGroup: method('remove_bot_from_group'),
  rotateToken: method('bot_rotate_token')
 },
 voice: {
  join: method('voice_join'),
  poll: method('voice_poll'),
  leave: method('voice_leave'),
  signal: method('voice_signal')
 },
 call: {
  start: method('dialog_call_start'),
  cancel: method('dialog_call_cancel'),
  decline: method('dialog_call_decline')
 },
 music: {
  state: method('music_state'),
  file: method('music_file'),
  command: method('music_command'),
  streamChunk: method('music_stream_chunk')
 },
 profileEffect: {
  upload: method('upload_profile_effect'),
  file: method('profile_effect_file'),
  list: method('list_profile_effects'),
  create: method('create_profile_effect'),
  apply: method('apply_profile_effect'),
  createDraft: method('create_profile_effect_draft'),
  getDraft: method('get_profile_effect_draft'),
  publish: method('publish_profile_effect'),
  unpublish: method('unpublish_profile_effect')
 },
 file: {
  avatar: method('avatar_file'),
  cover: method('profile_cover')
 },
 notifications: {setPreferences: method('set_notification_preferences')}
};

export type Api = typeof api;
