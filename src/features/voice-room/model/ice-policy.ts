export type IceServer = {urls?: string | string[]};

/** True when the backend handed out a TURN relay: only then can media avoid a direct path. */
export function hasRelay(servers: IceServer[] | undefined): boolean {
 if (!Array.isArray(servers)) return false;
 return servers.some(server => {
  const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
  return urls.some(url => typeof url === 'string' && (url.startsWith('turn:') || url.startsWith('turns:')));
 });
}

/** Discord always relays a call through its voice server. `relay` reproduces that: media only
 *  uses TURN, so a blocked or asymmetric direct path between peers cannot drop one direction. */
export function iceTransportPolicy(servers: IceServer[] | undefined, relayPreferred: boolean): 'relay' | 'all' {
 return relayPreferred && hasRelay(servers) ? 'relay' : 'all';
}
