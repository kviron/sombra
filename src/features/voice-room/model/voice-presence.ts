import {ApiConnectionError} from '@/shared/api';
import type {VoiceAvailability} from '@/shared/types';
import {voiceService} from './services/voice-service';
import type {Call} from './voice-call';

export function createVoicePresence(
 call: Call,
 availability: () => VoiceAvailability,
 onDelay: (delayed: boolean) => void
) {
 let admission: string | undefined;
 let retryDelay = 0;
 async function request(after: number, refreshIce: boolean) {
  if (!admission) {
   try {
    const data = await voiceService.poll({
     room: call.room,
     client: call.client,
     after,
     ...availability(),
     ...(refreshIce && {refreshIce})
    });
    return {data, readmitted: false};
   } catch (error) {
    // This legacy API reply identifies expired membership. Access denials must end the call.
    if (call.stop || !(error instanceof Error) || error.message !== 'Соединение завершено. Войдите в комнату снова.')
     throw error;
    // LiveKit identity belongs to the existing SFU session. P2P peers need fresh signaling.
    admission = call.audioOnly ? call.client : crypto.randomUUID();
   }
  }
  const client = admission;
  const data = await voiceService.join({room: call.room, client, ...availability()});
  if (call.stop || Boolean(data.liveKit) !== Boolean(call.audioOnly)) {
   void voiceService.leave({room: call.room, client}).catch(() => {});
   if (!call.stop) throw new Error('Тип голосовой комнаты изменился. Войдите в неё снова.');
   return;
  }
  call.client = client;
  admission = undefined;
  return {data, readmitted: true};
 }
 async function poll(after: number, refreshIce = false) {
  if (call.stop) return;
  try {
   const result = await request(after, refreshIce);
   if (call.stop) return;
   if (retryDelay >= 2000) onDelay(false);
   retryDelay = 0;
   return result;
  } catch (error) {
   if (call.stop) return;
   if (!(error instanceof ApiConnectionError)) throw error;
   retryDelay = retryDelay ? Math.min(retryDelay * 2, 5000) : 1000;
   if (retryDelay === 2000) onDelay(true);
  }
 }
 return {
  poll,
  interval: (normal: number) => Math.max(normal, retryDelay),
  stop() {
   if (admission && admission !== call.client)
    void voiceService.leave({room: call.room, client: admission}).catch(() => {});
  }
 };
}
