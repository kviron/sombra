import {conversationService} from '@/entities/conversation';
import {messageService} from '@/entities/message';
import type {Dialog} from '@/shared/types';
import {voiceInvitationText} from '../voice-invitation-rules';

export async function sendVoiceInvitation(group: string, channel: string, user: string) {
 const text = voiceInvitationText(group, channel);
 const dialog = await conversationService.createDialog<Dialog>({members: [user], name: ''});
 await messageService.send({channel: dialog.id, text});
}
