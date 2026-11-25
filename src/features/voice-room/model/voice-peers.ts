import type {VoicePeer} from '@/shared/types';
export type {VoicePeer} from '@/shared/types';

/** Keep the chat's state reference stable on idle polls; preserve server order and mute changes. */
export function reconcileVoicePeers(previous: VoicePeer[], incoming: VoicePeer[], ownClient: string) {
 const next = incoming.filter(peer => peer.client !== ownClient);
 if (
  previous.length === next.length &&
  next.every((peer, i) => {
   const old = previous[i];
   return peer.client === old.client && peer.user === old.user && peer.muted === old.muted && peer.deaf === old.deaf;
  })
 )
  return previous;
 return next;
}

export function otherMembers(peers: VoicePeer[], client: string) {
 const ownUser = peers.find(peer => peer.client === client)?.user;
 return new Set(peers.filter(peer => peer.client !== client && peer.user !== ownUser).map(peer => peer.user));
}
