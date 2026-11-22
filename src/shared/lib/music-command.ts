const commandActions={play:'add',pause:'pause',resume:'resume',skip:'skip',stop:'stop'} as const;

/** Maps `/play`, `/pause`, `/resume`, `/skip`, `/stop` text to a room-music action. */
export function parseMusicCommand(text:string){
 const match=/^\/(play|pause|resume|skip|stop)(?:\s+(.*))?$/i.exec(text.trim());
 if(!match)return undefined;
 const action=commandActions[match[1].toLowerCase() as keyof typeof commandActions];
 const args=match[2]?.trim();
 const parts=action==='add'&&args?/^(\S+)\s+(\S+)$/.exec(args):null;
 return {action,url:parts?.[1]??args,limit:parts?parseMusicLimit(parts[2]):undefined};
}
export function parseMusicLimit(raw:string){
 const n=Number(raw);
 return /^\d{1,4}$/.test(raw)&&n>=1&&n<=1000?n:NaN;
}
