import {api} from '@/shared/api';
import type {Channel, Group} from '@/shared/api/backend';

/** Группы и каналы: участники, приглашения, роли и настройки. */
export const groupService = {
 create: <T = Group>(payload: Record<string, unknown>) => api.group.create<T>(payload),
 update: (payload: Record<string, unknown>) => api.group.update(payload),
 join: <T = Group>(payload: Record<string, unknown>) => api.group.join<T>(payload),
 leave: (payload: Record<string, unknown>) => api.group.leave(payload),
 invite: (payload: Record<string, unknown>) => api.group.invite(payload),
 rotateInvite: (payload: Record<string, unknown>) => api.group.rotateInvite(payload),
 createChannel: <T = Channel>(payload: Record<string, unknown>) => api.group.createChannel<T>(payload),
 updateChannel: (payload: Record<string, unknown>) => api.group.updateChannel(payload),
 deleteChannel: (payload: Record<string, unknown>) => api.group.deleteChannel(payload),
 setMemberInvites: <T = Group>(payload: Record<string, unknown>) => api.group.setMemberInvites<T>(payload),
 setMemberRole: <T = Group>(payload: Record<string, unknown>) => api.group.setMemberRole<T>(payload),
 kickMember: <T = Group>(payload: Record<string, unknown>) => api.group.kickMember<T>(payload),
 saveRole: <T = Group>(payload: Record<string, unknown>) => api.group.saveRole<T>(payload),
 deleteRole: <T = Group>(payload: Record<string, unknown>) => api.group.deleteRole<T>(payload)
};
