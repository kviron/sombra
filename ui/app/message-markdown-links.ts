import type {Root,RootContent,Text,Link} from 'mdast';
import {normalizeLinkUrl,parseMessageLinks} from '../shared/lib/message-links.ts';

/** mdast URI serialization percent-encodes IPv6 authority brackets. Restore
 * only those brackets, then apply the unchanged shared HTTP-only URL policy.
 * Never percent-decode a scheme or other destination characters.
 */
export function normalizeMarkdownLinkUrl(value:string):string|null{
 const target=value.replace(/^(https?:\/\/)%5B([0-9a-f:.]+)%5D(?=[:/?#]|$)/i,'$1[$2]');
 return normalizeLinkUrl(target);
}

/** Keep Sombra's established HTTP-only link policy in Markdown text runs.
 * GFM's autolinks are recombined with adjacent text before applying that policy:
 * this preserves `Help (https://...)` labels and prevents a forbidden scheme
 * token from partially autolinking an embedded https host. Explicit Markdown
 * links and code are left to CommonMark/the safe anchor renderer.
 */
export function remarkSombraLinks(){
 return (tree:Root,file:{value:unknown})=>{
  const source=String(file.value);
  function automaticLink(node:RootContent):node is Link{
   if(node.type!=='link'||node.children.some(child=>child.type!=='text'))return false;
   // GFM's postprocessed www/email autolinks can omit source positions.
   // Explicit CommonMark links always carry a position in the parsed tree.
   if(!node.position)return true;
   const raw=source.slice(node.position.start.offset??0,node.position.end.offset??0);
   return !!raw&&!raw.startsWith('[')&&!raw.startsWith('<');
  }
  function visit(parent:{children:RootContent[]}){
   for(const node of parent.children){
    if(['link','image','html','code','inlineCode'].includes(node.type))continue;
    if('children' in node)visit(node as {children:RootContent[]});
   }
   const output:RootContent[]=[];
   for(let index=0;index<parent.children.length;){
    const node=parent.children[index];
    if(node.type!=='text'&&!automaticLink(node)){output.push(node);index++;continue}
    let text='';
    while(index<parent.children.length){
     const part=parent.children[index];
     if(part.type==='text')text+=part.value;
     else if(automaticLink(part))text+=part.children.map(child=>(child as Text).value).join('');
     else break;
     index++;
    }
    for(const part of parseMessageLinks(text)){
     if(part.type==='text')output.push({type:'text',value:part.text});
     else output.push({type:'link',url:part.href,children:[{type:'text',value:part.text}]});
    }
   }
   parent.children=output;
  }
  visit(tree);
 };
}
