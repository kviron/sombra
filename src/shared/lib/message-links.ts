export type MessageTextPart = {type:'text'; text:string} | {type:'link'; text:string; href:string};

/** The only URL policy used by both parsing and native opening. No URL repair. */
export function safeMessageUrl(value:string, bare=false):string|null {
 // eslint-disable-next-line no-control-regex -- ссылка не должна содержать управляющих символов
 if (!value || /[\s\u0000-\u001f\u007f\\<>"']/.test(value)) return null;
 if (!bare && (!/^https?:\/\//i.test(value) || /^https?:\/\/[^/?#]*@/i.test(value))) return null;
 if (bare && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?(?:[/?#]|$)/i.test(value)) return null;
 try {
  const url=new URL(bare?'https://'+value:value);
  if (!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password) return null;
  return url.href;
 } catch { return null; }
}

/** Public normalizer for explicit link targets (never accepts bare domains). */
export function normalizeLinkUrl(value:string):string|null { return safeMessageUrl(value); }

function trimEnd(value:string):string {
 let result=value;
 while (result) {
  if (/[.,!?;:]$/.test(result)) {result=result.slice(0,-1);continue;}
  const last=result.at(-1);
  const opener=last===')'?'(':last===']'?'[':last==='}'?'{':null;
  if (opener && result.split(last!).length>result.split(opener).length) {result=result.slice(0,-1);continue;}
  break;
 }
 return result;
}

/** Read a parenthesized target, preserving balanced parentheses inside URL paths. */
function targetAt(text:string,start:number):{target:string;end:number}|null {
 let depth=1;
 for(let i=start;i<text.length;i++) {
  if (/\s/.test(text[i])) return null;
  if(text[i]==='(') depth++;
  if(text[i]===')' && --depth===0) return {target:text.slice(start,i),end:i+1};
 }
 return null;
}

/** Pure, dependency-free parser. Non-link text is returned verbatim; HTML is never parsed. */
export function parseMessageLinks(text:string):MessageTextPart[] {
 const parts:MessageTextPart[]=[];
 const plain=(value:string)=>{if(!value)return;const previous=parts.at(-1);if(previous?.type==='text')previous.text+=value;else parts.push({type:'text',text:value});};
 let i=0;
 while(i<text.length) {
  const rest=text.slice(i);
  const boundary=i===0||/[\s([{"'<>]/.test(text[i-1]);
  if(rest[0]==='[') {
   const label=/^\[((?:\\[^\n]|[^\\\]\n])+)\]\(/.exec(rest);
   if(label) {
    const target=targetAt(text,i+label[0].length);
    if(target) {
     const href=safeMessageUrl(target.target);
     if(href) parts.push({type:'link',text:label[1].replace(/\\([\\[\]])/g,'$1'),href});else plain(text.slice(i,target.end));
     i=target.end;continue;
    }
   }
  }
  if(boundary) {
   // Human labels: a domain, one word, or a short phrase (up to six words).
   const label=/^([\p{L}\p{N}][\p{L}\p{N}_.-]*(?:[ \t]+[\p{L}\p{N}][\p{L}\p{N}_.-]*){0,5})[ \t]+\(/u.exec(rest);
   if(label) {
    const target=targetAt(text,i+label[0].length);
    if(target) {
     const href=safeMessageUrl(target.target);
     if(href) {parts.push({type:'link',text:label[1],href});i=target.end;continue;}
    }
   }
   // Consume ALL scheme tokens, including disallowed ones, to prevent nested-host linking.
   const scheme=/^[a-z][a-z\d+.-]*:\S*/i.exec(rest);
   if(scheme) {
    const candidate=trimEnd(scheme[0].split(/[<>"']/)[0]);
    const href=safeMessageUrl(candidate);
    if(href) {parts.push({type:'link',text:candidate,href});i+=candidate.length;}
    else {plain(scheme[0]);i+=scheme[0].length;}
    continue;
   }
   const email=/^[^\s<>"'@]+@[^\s<>"']+/.exec(rest);
   if(email) {plain(email[0]);i+=email[0].length;continue;}
   const domain=/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?(?:[/?#][^\s<>"']*)?/i.exec(rest);
   if(domain && !/[\w@.-]/.test(rest[domain[0].length]||'')) {
    const candidate=trimEnd(domain[0]);
    const href=safeMessageUrl(candidate,true);
    if(href) {parts.push({type:'link',text:candidate,href});i+=candidate.length;continue;}
   }
  }
  plain(text[i]);i++;
 }
 return parts;
}
